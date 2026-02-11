"""
Deploy Router — One-Click OpenClaw Container Deployment

Endpoints:
  GET  /api/deploy/schema     — Get form field schema (mandatory/optional/auto)
  POST /api/deploy/configure  — Generate .env from customer input
  POST /api/deploy/launch     — Start the Docker container
  POST /api/deploy/stop       — Stop a running deployment
  GET  /api/deploy/status     — Get deployment container status
  GET  /api/deploy/logs       — Get deployment container logs
  GET  /api/deploy/list       — List all tracked deployments
"""

import json
import logging
import uuid
import asyncio
from typing import Optional

import httpx
import websockets
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.deployer import deployer

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/deploy", tags=["deploy"])


# --- Request/Response Models ---

class DeployConfigureRequest(BaseModel):
    """Customer input for generating a deployment .env file."""
    # Mandatory
    openrouter_api_key: str

    # Optional LLM keys
    anthropic_api_key: Optional[str] = None
    openai_api_key: Optional[str] = None

    # Optional Telegram
    telegram_bot_token: Optional[str] = None
    telegram_user_id: Optional[str] = None

    # Optional WhatsApp
    whatsapp_number: Optional[str] = None


class DeployActionRequest(BaseModel):
    """Reference an existing deployment by ID."""
    deployment_id: str


# --- Endpoints ---

@router.get("/schema")
async def get_deploy_schema():
    """Get the form field schema for the deploy UI.

    Returns field definitions grouped by: auto, mandatory, optional.
    The UI uses this to dynamically render the deploy form.
    """
    await deployer.restore_deployments()
    return deployer.get_field_schema()


@router.post("/configure")
async def configure_deployment(req: DeployConfigureRequest):
    """Generate .env and prepare deployment directory from customer input.

    Auto-generates: PORT (random 10000-65000), OPENCLAW_GATEWAY_TOKEN (random hex).
    Validates: mandatory fields present, telegram dependency check.
    Creates: deployments/<id>/.env, docker-compose.yml, config/, workspace/
    """
    deployment_id = uuid.uuid4().hex[:10]

    await deployer.restore_deployments()
    try:
        mandatory = {
            "OPENROUTER_API_KEY": req.openrouter_api_key,
        }
        optional = {
            "ANTHROPIC_API_KEY": req.anthropic_api_key or "",
            "OPENAI_API_KEY": req.openai_api_key or "",
            "TELEGRAM_BOT_TOKEN": req.telegram_bot_token or "",
            "TELEGRAM_USER_ID": req.telegram_user_id or "",
            "WHATSAPP_NUMBER": req.whatsapp_number or "",
        }

        result = deployer.generate_env(deployment_id, mandatory, optional)
        return {
            "ok": True,
            "deployment_id": result["deployment_id"],
            "port": result["port"],
            "gateway_token": result["gateway_token"],
            "status": result["status"],
            "message": f"Deployment configured. Port: {result['port']}. Ready to launch.",
        }
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.error(f"Configure failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/launch")
async def launch_deployment(req: DeployActionRequest):
    """Launch the Docker container for a configured deployment.

    Runs: docker compose -f <path> --env-file <path> up -d
    """
    await deployer.restore_deployments()
    try:
        result = await deployer.launch(req.deployment_id)
        return {
            "ok": True,
            "deployment_id": result["deployment_id"],
            "port": result["port"],
            "gateway_token": result["gateway_token"],
            "status": result["status"],
            "message": f"Container launched on port {result['port']}. "
                       f"Connect via ws://<host>:{result['port']}",
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.error(f"Launch failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/stop")
async def stop_deployment(req: DeployActionRequest):
    """Stop a running deployment container."""
    await deployer.restore_deployments()
    try:
        result = await deployer.stop(req.deployment_id)
        return {
            "ok": True,
            "deployment_id": result["deployment_id"],
            "status": result["status"],
            "message": "Container stopped.",
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/status/{deployment_id}")
async def get_deployment_status(deployment_id: str):
    """Get container status for a deployment."""
    await deployer.restore_deployments()
    try:
        return await deployer.get_status(deployment_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/logs/{deployment_id}")
async def get_deployment_logs(deployment_id: str, tail: int = 50):
    """Get recent container logs for a deployment."""
    await deployer.restore_deployments()
    try:
        logs = await deployer.get_logs(deployment_id, tail)
        return {"deployment_id": deployment_id, "logs": logs}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/list")
async def list_deployments():
    """List all tracked deployments."""
    await deployer.restore_deployments()
    return deployer.list_deployments()


@router.get("/gateway-health/{deployment_id}")
async def check_gateway_health(deployment_id: str):
    """Check if the deployed container's gateway is accessible and healthy.

    Performs:
      1. HTTP GET to http://localhost:<port>/?token=<gateway_token> (authenticates the gateway)
      2. WebSocket handshake to ws://localhost:<port> with token (verifies chat readiness)

    Returns:
      { healthy: bool, http_ok: bool, ws_ok: bool, detail: str }
    """
    await deployer.restore_deployments()
    info = deployer._active_deployments.get(deployment_id)
    if not info:
        raise HTTPException(status_code=404, detail=f"Deployment {deployment_id} not found")

    port = info.get("port")
    token = info.get("gateway_token", "")
    status = info.get("status")

    if status != "running":
        return {"healthy": False, "http_ok": False, "ws_ok": False, "detail": f"Container not running (status: {status})"}

    http_ok = False
    ws_ok = False
    detail = ""

    # Step 1: HTTP probe with token
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"http://localhost:{port}/?token={token}")
            http_ok = resp.status_code < 500
            detail = f"HTTP {resp.status_code}"
    except Exception as e:
        detail = f"HTTP probe failed: {e}"

    # Step 2: WebSocket handshake probe (only if HTTP passed)
    # Uses the full OpenClaw gateway connect protocol (minProtocol, maxProtocol, client, auth)
    if http_ok:
        try:
            ws = await asyncio.wait_for(
                websockets.connect(f"ws://localhost:{port}", ping_interval=None),
                timeout=8,
            )
            # Read the challenge frame
            raw = await asyncio.wait_for(ws.recv(), timeout=5)
            challenge = json.loads(raw)
            if challenge.get("type") == "event" and challenge.get("event") == "connect.challenge":
                connect_req = {
                    "type": "req",
                    "id": f"health-{uuid.uuid4().hex[:8]}",
                    "method": "connect",
                    "params": {
                        "minProtocol": 3,
                        "maxProtocol": 3,
                        "client": {
                            "id": "cli",
                            "version": "1.0.0",
                            "platform": "linux",
                            "mode": "backend",
                            "instanceId": uuid.uuid4().hex[:8],
                        },
                        "role": "operator",
                        "scopes": ["operator.admin"],
                        "caps": [],
                        "auth": {"token": token},
                        "userAgent": "Aether-HealthCheck/1.0",
                        "locale": "en-US",
                    },
                }
                await ws.send(json.dumps(connect_req))
                # Read response, skipping any intermediate events
                for _ in range(10):
                    resp_raw = await asyncio.wait_for(ws.recv(), timeout=5)
                    resp_data = json.loads(resp_raw)
                    if resp_data.get("type") == "res":
                        ws_ok = resp_data.get("ok", False)
                        if not ws_ok:
                            error = resp_data.get("error", {})
                            detail += f" | WS connect rejected: {error.get('code', '?')}: {error.get('message', '?')}"
                        else:
                            detail += " | WS handshake OK"
                        break
                else:
                    detail += " | No connect response received"
            else:
                detail += f" | Unexpected challenge: {challenge.get('type')}"
            await ws.close()
        except Exception as e:
            detail += f" | WS probe failed: {e}"

    healthy = http_ok and ws_ok
    return {
        "healthy": healthy,
        "http_ok": http_ok,
        "ws_ok": ws_ok,
        "port": port,
        "detail": detail,
    }
