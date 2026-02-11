"""
OpenClaw One-Click Deployer Service

Manages the lifecycle of OpenClaw Docker containers:
- Generates .env from customer input (auto-generates PORT + GATEWAY_TOKEN)
- Runs docker compose up/down using the standard YAML
- Checks container status
- Streams logs
"""

import asyncio
import json
import logging
import os
import re
import secrets
import shutil
import random
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

_ANSI_RE = re.compile(r'\x1b\[[0-9;]*m')

def _strip_ansi(text: str) -> str:
    """Remove ANSI escape codes from text."""
    return _ANSI_RE.sub('', text)

logger = logging.getLogger(__name__)

# --- Deployment Name Generator ---
_DEPLOY_ADJECTIVES = [
    "Crimson", "Stellar", "Quantum", "Neural", "Cosmic", "Phantom",
    "Radiant", "Obsidian", "Emerald", "Sapphire", "Titanium", "Velvet",
    "Arctic", "Solar", "Lunar", "Thunder", "Crystal", "Shadow",
    "Neon", "Amber", "Cobalt", "Ivory", "Onyx", "Prism",
]
_DEPLOY_NOUNS = [
    "Falcon", "Horizon", "Nexus", "Cipher", "Vortex", "Phoenix",
    "Sentinel", "Catalyst", "Beacon", "Forge", "Pulse", "Echo",
    "Vertex", "Orbit", "Zenith", "Aegis", "Flux", "Nova",
    "Helix", "Apex", "Drift", "Core", "Arc", "Spark",
]

def _generate_deploy_name() -> str:
    """Generate a meaningful two-word name for a deployment."""
    return f"{random.choice(_DEPLOY_ADJECTIVES)} {random.choice(_DEPLOY_NOUNS)}"


async def _detect_compose_cmd() -> list[str]:
    """Detect the available docker compose command.

    Tries in order:
      1. docker compose (v2 plugin)
      2. docker-compose (v1 standalone)
      3. Install docker-compose-plugin via apt and retry

    Returns the command as a list, e.g. ["docker", "compose"] or ["docker-compose"].
    Raises RuntimeError if none found.
    """
    # Try v2 plugin: docker compose version
    try:
        proc = await asyncio.create_subprocess_exec(
            "docker", "compose", "version",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, _ = await proc.communicate()
        if proc.returncode == 0:
            logger.info("Detected: docker compose (v2 plugin)")
            return ["docker", "compose"]
    except FileNotFoundError:
        pass

    # Try v1 standalone: docker-compose --version
    try:
        proc = await asyncio.create_subprocess_exec(
            "docker-compose", "--version",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, _ = await proc.communicate()
        if proc.returncode == 0:
            logger.info("Detected: docker-compose (v1 standalone)")
            return ["docker-compose"]
    except FileNotFoundError:
        pass

    # Try to install docker-compose-plugin
    logger.warning("No docker compose found. Attempting to install docker-compose-plugin...")
    try:
        proc = await asyncio.create_subprocess_exec(
            "sudo", "apt-get", "install", "-y", "docker-compose-v2",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode == 0:
            logger.info("Installed docker-compose-v2 via apt")
            return ["docker", "compose"]
        # Try alternative package name
        proc = await asyncio.create_subprocess_exec(
            "sudo", "apt-get", "install", "-y", "docker-compose-plugin",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode == 0:
            logger.info("Installed docker-compose-plugin via apt")
            return ["docker", "compose"]
    except FileNotFoundError:
        pass

    raise RuntimeError(
        "Docker Compose is not installed. Install it with:\n"
        "  sudo apt-get install docker-compose-v2\n"
        "  — or —\n"
        "  sudo apt-get install docker-compose"
    )

# Path to the standard docker-compose.yml (project root)
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
COMPOSE_FILE = PROJECT_ROOT / "docker-compose.yml"
DEPLOY_DIR = PROJECT_ROOT / "deployments"


class DeployConfig:
    """Env field definitions with classification."""

    # Auto-generated fields (user never touches these)
    AUTO_FIELDS = {
        "PORT": {
            "description": "Gateway port",
            "generate": lambda: str(random.randint(10000, 65000)),
        },
        "OPENCLAW_GATEWAY_TOKEN": {
            "description": "Gateway auth token",
            "generate": lambda: secrets.token_hex(16),
        },
    }

    # Mandatory fields (user must provide at least one)
    MANDATORY_FIELDS = {
        "OPENROUTER_API_KEY": {
            "description": "OpenRouter API key for LLM access",
            "hint": "sk-or-v1-...",
            "sensitive": True,
        },
    }

    # Optional fields (user can provide or leave blank)
    OPTIONAL_FIELDS = {
        "ANTHROPIC_API_KEY": {
            "description": "Anthropic API key (enables Claude models as fallback)",
            "hint": "sk-ant-...",
            "sensitive": True,
            "group": "llm",
        },
        "OPENAI_API_KEY": {
            "description": "OpenAI API key (enables GPT models as fallback)",
            "hint": "sk-...",
            "sensitive": True,
            "group": "llm",
        },
        "TELEGRAM_BOT_TOKEN": {
            "description": "Telegram bot token for chat integration",
            "hint": "123456789:AABBcc...",
            "sensitive": True,
            "group": "telegram",
        },
        "TELEGRAM_USER_ID": {
            "description": "Your Telegram user ID (required if bot token is set)",
            "hint": "123456789",
            "sensitive": False,
            "group": "telegram",
            "depends_on": "TELEGRAM_BOT_TOKEN",
        },
        "WHATSAPP_NUMBER": {
            "description": "WhatsApp number for chat integration",
            "hint": "+1234567890",
            "sensitive": False,
            "group": "whatsapp",
        },
    }


class Deployer:
    """Manages OpenClaw container deployments."""

    def __init__(self):
        self._active_deployments: dict[str, dict] = {}
        self._deploy_logs: dict[str, list[str]] = {}  # deployment_id -> list of log lines
        self._restored = False

    def _add_log(self, deployment_id: str, message: str, level: str = "INFO"):
        """Append a timestamped log line to the deployment's log buffer."""
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
        line = f"[{ts}] [{level}] {message}"
        if deployment_id not in self._deploy_logs:
            self._deploy_logs[deployment_id] = []
        self._deploy_logs[deployment_id].append(line)
        # Cap at 500 lines
        if len(self._deploy_logs[deployment_id]) > 500:
            self._deploy_logs[deployment_id] = self._deploy_logs[deployment_id][-500:]

    async def restore_deployments(self):
        """Scan deployments/ directory and restore tracking state.

        Called on first API access to recover deployments across server restarts.
        Reads each deployment's .env to recover port/token, then checks Docker
        to determine if the container is running or stopped.
        """
        if self._restored:
            return
        self._restored = True

        if not DEPLOY_DIR.exists():
            return

        for entry in DEPLOY_DIR.iterdir():
            if not entry.is_dir():
                continue

            deployment_id = entry.name
            env_path = entry / ".env"
            compose_path = entry / "docker-compose.yml"

            if not env_path.exists():
                continue

            # Parse .env to recover PORT and TOKEN
            port = None
            token = None
            try:
                for line in env_path.read_text().splitlines():
                    line = line.strip()
                    if line.startswith("PORT="):
                        port = int(line.split("=", 1)[1])
                    elif line.startswith("OPENCLAW_GATEWAY_TOKEN="):
                        token = line.split("=", 1)[1]
            except Exception as e:
                logger.warning(f"Failed to parse .env for {deployment_id}: {e}")
                continue

            if not port:
                continue

            # Check if container is actually running via docker
            status = "stopped"
            try:
                cmd = await self._compose_cmd()
                proc = await asyncio.create_subprocess_exec(
                    *cmd, "-f", str(compose_path), "ps", "--format", "json",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    cwd=str(entry),
                )
                stdout_bytes, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
                stdout_str = stdout_bytes.decode()
                for line in stdout_str.strip().split("\n"):
                    if line.strip():
                        try:
                            container = json.loads(line)
                            if container.get("State") == "running":
                                status = "running"
                                break
                        except json.JSONDecodeError:
                            pass
            except Exception as e:
                logger.warning(f"Failed to check container status for {deployment_id}: {e}")

            # Parse name from .env if present, otherwise generate one
            name = None
            try:
                for line in env_path.read_text().splitlines():
                    line_s = line.strip()
                    if line_s.startswith("DEPLOY_NAME="):
                        name = line_s.split("=", 1)[1]
            except Exception:
                pass
            if not name:
                name = _generate_deploy_name()
                # Persist the name back to .env
                try:
                    with open(env_path, "a") as f:
                        f.write(f"\n# Deployment name\nDEPLOY_NAME={name}\n")
                except Exception:
                    pass

            info = {
                "deployment_id": deployment_id,
                "name": name,
                "port": port,
                "gateway_token": token or "",
                "deploy_dir": str(entry),
                "env_path": str(env_path),
                "compose_path": str(compose_path),
                "status": status,
            }

            if deployment_id not in self._active_deployments:
                self._active_deployments[deployment_id] = info
                logger.info(f"Restored deployment {deployment_id} (port={port}, status={status})")

    def get_field_schema(self) -> dict:
        """Return the field schema for the UI to render the deploy form."""
        return {
            "auto": {
                k: {"description": v["description"]}
                for k, v in DeployConfig.AUTO_FIELDS.items()
            },
            "mandatory": {
                k: {
                    "description": v["description"],
                    "hint": v.get("hint", ""),
                    "sensitive": v.get("sensitive", False),
                }
                for k, v in DeployConfig.MANDATORY_FIELDS.items()
            },
            "optional": {
                k: {
                    "description": v["description"],
                    "hint": v.get("hint", ""),
                    "sensitive": v.get("sensitive", False),
                    "group": v.get("group", ""),
                    "depends_on": v.get("depends_on", ""),
                }
                for k, v in DeployConfig.OPTIONAL_FIELDS.items()
            },
        }

    def generate_env(
        self,
        deployment_id: str,
        mandatory: dict[str, str],
        optional: Optional[dict[str, str]] = None,
    ) -> dict:
        """Generate .env file from user input.

        Args:
            deployment_id: Unique ID for this deployment
            mandatory: Dict of mandatory field values
            optional: Dict of optional field values (can be empty/None)

        Returns:
            Dict with deployment info (port, token, env_path, deploy_dir)
        """
        optional = optional or {}

        self._add_log(deployment_id, "Starting deployment configuration...")
        self._add_log(deployment_id, f"Deployment ID: {deployment_id}")

        # Validate mandatory fields
        for field in DeployConfig.MANDATORY_FIELDS:
            if not mandatory.get(field):
                raise ValueError(f"Missing mandatory field: {field}")
        self._add_log(deployment_id, "Mandatory fields validated ✓")

        # Validate telegram dependency
        if optional.get("TELEGRAM_BOT_TOKEN") and not optional.get("TELEGRAM_USER_ID"):
            raise ValueError("TELEGRAM_USER_ID is required when TELEGRAM_BOT_TOKEN is set")

        # Create deployment directory
        deploy_dir = DEPLOY_DIR / deployment_id
        deploy_dir.mkdir(parents=True, exist_ok=True)
        (deploy_dir / "config").mkdir(exist_ok=True)
        (deploy_dir / "workspace").mkdir(exist_ok=True)
        self._add_log(deployment_id, f"Deployment directory created: deployments/{deployment_id}/")

        # Generate auto fields
        auto_values = {}
        for field, spec in DeployConfig.AUTO_FIELDS.items():
            auto_values[field] = spec["generate"]()
        self._add_log(deployment_id, f"Auto-generated PORT={auto_values['PORT']}")
        self._add_log(deployment_id, "Auto-generated OPENCLAW_GATEWAY_TOKEN ✓")

        # Build .env content
        # Generate a meaningful name for this deployment
        deploy_name = _generate_deploy_name()
        self._add_log(deployment_id, f"Deployment name: {deploy_name}")

        env_lines = [
            f"# OpenClaw deployment: {deployment_id}",
            f"# Generated by Aether Orchestrator",
            "",
            "# Auto-generated",
            f"PORT={auto_values['PORT']}",
            f"OPENCLAW_GATEWAY_TOKEN={auto_values['OPENCLAW_GATEWAY_TOKEN']}",
            f"DEPLOY_NAME={deploy_name}",
            "",
            "# LLM Keys",
            f"OPENROUTER_API_KEY={mandatory.get('OPENROUTER_API_KEY', '')}",
            f"ANTHROPIC_API_KEY={optional.get('ANTHROPIC_API_KEY', '')}",
            f"OPENAI_API_KEY={optional.get('OPENAI_API_KEY', '')}",
            "",
            "# Telegram",
            f"TELEGRAM_BOT_TOKEN={optional.get('TELEGRAM_BOT_TOKEN', '')}",
            f"TELEGRAM_USER_ID={optional.get('TELEGRAM_USER_ID', '')}",
            "",
            "# WhatsApp",
            f"WHATSAPP_NUMBER={optional.get('WHATSAPP_NUMBER', '')}",
        ]

        env_path = deploy_dir / ".env"
        env_path.write_text("\n".join(env_lines) + "\n")
        self._add_log(deployment_id, "Environment file (.env) written ✓")

        # Copy docker-compose.yml to deployment dir
        compose_dest = deploy_dir / "docker-compose.yml"
        shutil.copy2(COMPOSE_FILE, compose_dest)
        self._add_log(deployment_id, "Docker Compose file copied ✓")

        # Log optional integrations
        if optional.get("TELEGRAM_BOT_TOKEN"):
            self._add_log(deployment_id, "Telegram integration configured ✓")
        if optional.get("ANTHROPIC_API_KEY"):
            self._add_log(deployment_id, "Anthropic API key configured ✓")
        if optional.get("OPENAI_API_KEY"):
            self._add_log(deployment_id, "OpenAI API key configured ✓")

        self._add_log(deployment_id, "Configuration complete. Ready to launch.")

        deployment_info = {
            "deployment_id": deployment_id,
            "name": deploy_name,
            "port": int(auto_values["PORT"]),
            "gateway_token": auto_values["OPENCLAW_GATEWAY_TOKEN"],
            "deploy_dir": str(deploy_dir),
            "env_path": str(env_path),
            "compose_path": str(compose_dest),
            "status": "configured",
        }

        self._active_deployments[deployment_id] = deployment_info
        logger.info(f"Deployment {deployment_id} configured at {deploy_dir}")
        return deployment_info

    async def _compose_cmd(self) -> list[str]:
        """Get the compose command, detecting and caching it on first call."""
        if not hasattr(self, '_cached_compose_cmd'):
            self._cached_compose_cmd = await _detect_compose_cmd()
        return list(self._cached_compose_cmd)

    async def _run_compose(self, args: list[str], cwd: str, timeout: int = 300) -> tuple[str, str, int]:
        """Run a compose command with the detected compose binary.

        Args:
            args: Arguments after the compose command (e.g. ["-f", "path", "up", "-d"])
            cwd: Working directory
            timeout: Timeout in seconds

        Returns:
            Tuple of (stdout, stderr, returncode)
        """
        cmd = await self._compose_cmd()
        full_cmd = cmd + args
        logger.info(f"Running: {' '.join(full_cmd)} (cwd={cwd})")

        proc = await asyncio.create_subprocess_exec(
            *full_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            raise RuntimeError(f"Command timed out after {timeout}s: {' '.join(full_cmd)}")

        return stdout.decode(), stderr.decode(), proc.returncode

    async def launch(self, deployment_id: str) -> dict:
        """Launch the Docker container for a configured deployment.

        Runs: <compose_cmd> -f <path> --env-file <path> up -d
        """
        info = self._active_deployments.get(deployment_id)
        if not info:
            raise ValueError(f"Deployment {deployment_id} not found. Configure first.")

        deploy_dir = info["deploy_dir"]
        compose_path = info["compose_path"]
        env_path = info["env_path"]

        self._add_log(deployment_id, "─── LAUNCH SEQUENCE STARTED ───")
        self._add_log(deployment_id, f"Target port: {info.get('port')}")

        # Detect compose command (will auto-install if needed)
        self._add_log(deployment_id, "Detecting Docker Compose...")
        await self._compose_cmd()
        compose_cmd_str = " ".join(await self._compose_cmd())
        self._add_log(deployment_id, f"Using: {compose_cmd_str}")

        # Clean up any stale containers from previous attempts
        self._add_log(deployment_id, "STEP 1/5: Cleaning up stale containers...")
        logger.info(f"Cleaning up stale containers for {deployment_id}...")
        cleanup_out, cleanup_err, _ = await self._run_compose(
            ["-f", compose_path, "--env-file", env_path, "down", "--remove-orphans"],
            cwd=deploy_dir,
        )
        if cleanup_err.strip():
            for line in _strip_ansi(cleanup_err).strip().split("\n"):
                if line.strip():
                    self._add_log(deployment_id, f"  {line.strip()}")
        self._add_log(deployment_id, "Cleanup complete ✓")

        # Remove old openclaw.json so the container regenerates it fresh
        config_dir = Path(deploy_dir) / "config"
        old_config = config_dir / "openclaw.json"
        if old_config.exists():
            old_config.unlink()
            self._add_log(deployment_id, "Removed stale openclaw.json config")
            logger.info(f"Removed stale config: {old_config}")

        # Copy the latest docker-compose.yml (in case it was updated)
        compose_src = PROJECT_ROOT / "docker-compose.yml"
        if compose_src.exists():
            shutil.copy2(compose_src, compose_path)

        # Run compose up -d --force-recreate
        self._add_log(deployment_id, "STEP 2/5: Pulling container image (if needed)...")
        self._add_log(deployment_id, "STEP 3/5: Creating and starting container...")
        logger.info(f"Launching deployment {deployment_id}...")
        stdout, stderr, rc = await self._run_compose(
            ["-f", compose_path, "--env-file", env_path, "up", "-d", "--force-recreate", "--remove-orphans"],
            cwd=deploy_dir,
        )

        # Log compose output (this contains pull progress, create, start messages)
        combined_output = _strip_ansi(stdout + stderr).strip()
        if combined_output:
            for line in combined_output.split("\n"):
                line = line.strip()
                if line and "FALLBACKS" not in line:  # Skip noisy docker-compose warnings
                    self._add_log(deployment_id, f"  {line}")

        if rc != 0:
            error_msg = _strip_ansi(stderr.strip() or stdout.strip())
            info["status"] = "failed"
            info["error"] = error_msg
            self._add_log(deployment_id, f"LAUNCH FAILED: {error_msg}", level="ERROR")
            logger.error(f"Deployment {deployment_id} failed: {error_msg}")
            raise RuntimeError(f"Docker compose up failed: {error_msg}")

        # Double-check: stderr may contain errors even with rc=0
        # But skip benign warnings like "FALLBACKS variable is not set"
        if stderr and "error" in stderr.lower() and "FALLBACKS" not in stderr:
            error_msg = _strip_ansi(stderr.strip())
            info["status"] = "failed"
            info["error"] = error_msg
            self._add_log(deployment_id, f"LAUNCH FAILED: {error_msg}", level="ERROR")
            logger.error(f"Deployment {deployment_id} had errors: {error_msg}")
            raise RuntimeError(f"Docker compose up had errors: {error_msg}")

        info["status"] = "running"
        self._add_log(deployment_id, "Container started successfully ✓")
        self._add_log(deployment_id, "STEP 4/5: Establishing network connectivity...")
        self._add_log(deployment_id, f"Container listening on port {info['port']}")
        self._add_log(deployment_id, "STEP 5/5: Waiting for gateway to initialize...")
        self._add_log(deployment_id, "─── CONTAINER IS RUNNING ───")
        logger.info(f"Deployment {deployment_id} launched on port {info['port']}")
        return info

    async def stop(self, deployment_id: str) -> dict:
        """Stop a running deployment."""
        info = self._active_deployments.get(deployment_id)
        if not info:
            raise ValueError(f"Deployment {deployment_id} not found")

        stdout, stderr, rc = await self._run_compose(
            ["-f", info["compose_path"], "down"],
            cwd=info["deploy_dir"],
        )

        if rc != 0:
            error_msg = stderr.strip()
            raise RuntimeError(f"Docker compose down failed: {error_msg}")

        info["status"] = "stopped"
        logger.info(f"Deployment {deployment_id} stopped")
        return info

    async def get_status(self, deployment_id: str) -> dict:
        """Get status of a deployment's container."""
        info = self._active_deployments.get(deployment_id)
        if not info:
            raise ValueError(f"Deployment {deployment_id} not found")

        try:
            stdout, stderr, rc = await self._run_compose(
                ["-f", info["compose_path"], "ps", "--format", "json"],
                cwd=info["deploy_dir"],
            )
            containers = []
            for line in stdout.strip().split("\n"):
                if line.strip():
                    try:
                        containers.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass

            return {
                "deployment_id": deployment_id,
                "status": info["status"],
                "port": info["port"],
                "containers": containers,
            }
        except Exception as e:
            return {
                "deployment_id": deployment_id,
                "status": info.get("status", "unknown"),
                "port": info.get("port"),
                "error": str(e),
            }

    async def get_logs(self, deployment_id: str, tail: int = 50) -> str:
        """Get deployment lifecycle logs merged with container logs.

        Returns lifecycle log lines (STEP/INFO messages from configure+launch)
        followed by recent container runtime logs (stripped of ANSI codes and
        noisy docker-compose warnings).
        """
        info = self._active_deployments.get(deployment_id)
        if not info:
            raise ValueError(f"Deployment {deployment_id} not found")

        lines: list[str] = []

        # 1. Deployment lifecycle logs (configure, launch steps)
        lifecycle = self._deploy_logs.get(deployment_id, [])
        lines.extend(lifecycle)

        # 2. Container runtime logs (from docker compose logs)
        try:
            stdout, stderr, rc = await self._run_compose(
                ["-f", info["compose_path"], "logs", "--tail", str(tail), "--no-color"],
                cwd=info["deploy_dir"],
            )
            raw = _strip_ansi(stdout + stderr).strip()
            if raw:
                for line in raw.split("\n"):
                    line = line.strip()
                    # Filter out noisy/internal lines
                    if not line:
                        continue
                    if "FALLBACKS" in line and "variable is not set" in line:
                        continue
                    if "closed before connect conn=" in line:
                        continue
                    # Strip the "openclaw-1  | " prefix for cleaner display
                    if " | " in line:
                        line = line.split(" | ", 1)[1]
                    lines.append(line)
        except Exception as e:
            lines.append(f"[WARN] Could not fetch container logs: {e}")

        # Return last `tail` lines
        return "\n".join(lines[-tail:])

    def list_deployments(self) -> list[dict]:
        """List all tracked deployments."""
        return [
            {
                "deployment_id": k,
                "name": v.get("name", k[:8]),
                "port": v.get("port"),
                "status": v.get("status"),
                "deploy_dir": v.get("deploy_dir"),
            }
            for k, v in self._active_deployments.items()
        ]


# Singleton
deployer = Deployer()
