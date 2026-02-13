# Bug Fix: Deploy Agent — Docker Compose Errors (Multiple Issues)

**Date:** 2026-02-10
**Status:** Resolved
**Severity:** Blocker — Deploy Agent feature completely non-functional

---

## Overview

After fixing the initial 404 "Not Found" error (see `bug_fix_deploy_not_found_404.md`), the Deploy Agent feature hit a chain of 4 additional bugs. This document traces every step.

---

## Bug Chain Summary

| # | Error | Root Cause | Fix |
|---|-------|-----------|-----|
| 1 | `Docker Compose not available` | v2 plugin not installed on Ubuntu | Auto-detection + apt install |
| 2 | `permission denied` on docker.sock | User not in `docker` group | `sudo usermod -aG docker oc` |
| 3 | `option '--port' argument missing` | `$$PORT` in YAML references wrong env var | Changed to `$$OPENCLAW_GATEWAY_PORT` |
| 4 | Container name conflict on re-launch | Stale containers from failed attempts | Added `down --remove-orphans` before `up` |
| 5 | False success on failed launch | `docker compose up -d` can return rc=0 with errors | Added stderr error check |

---

## Bug 1: Docker Compose Not Available

### Symptom
```
Deploy failed: Docker Compose not available
```

### Debugging

**Step 1: Check what Docker is installed**
```bash
$ docker --version
Docker version 28.2.2, build 28.2.2-0ubuntu1~24.04.1

$ docker compose version
docker: unknown command: docker compose

$ docker-compose --version
Command 'docker-compose' not found
```

**Purpose:** Determine which compose variant is available.
**Finding:** Docker v28.2.2 installed via `docker.io` Ubuntu package, which does NOT include the Compose v2 plugin. Neither `docker compose` (v2) nor `docker-compose` (v1) exists.

**Step 2: Check installed Docker packages**
```bash
$ apt list --installed 2>/dev/null | grep docker
docker.io/noble-updates,now 28.2.2-0ubuntu1~24.04.1 amd64 [installed]
```

**Purpose:** Confirm the Docker installation source.
**Finding:** Only `docker.io` (Ubuntu package) installed. The `docker-compose-v2` plugin package is missing.

**Step 3: Check the failing code in deployer.py**
```python
# api/services/deployer.py — launch() method (BEFORE fix)
proc = await asyncio.create_subprocess_exec(
    "docker", "compose", "version",  # <-- This fails: "unknown command"
    ...
)
if proc.returncode != 0:
    raise RuntimeError("Docker Compose not available")
```

**Purpose:** Trace the exact code path that raises the error.
**Finding:** The deployer hardcoded `"docker", "compose"` everywhere. No fallback to `docker-compose` (v1) and no auto-install.

### Fix

**Fix 1a: Install docker-compose-v2**
```bash
$ sudo apt-get update -qq && sudo apt-get install -y docker-compose-v2
Setting up docker-compose-v2 (2.37.1+ds1-0ubuntu2~24.04.1) ...

$ docker compose version
Docker Compose version 2.37.1+ds1-0ubuntu2~24.04.1
```

**Fix 1b: Add auto-detection to deployer.py**

Added `_detect_compose_cmd()` function that tries in order:
1. `docker compose version` (v2 plugin)
2. `docker-compose --version` (v1 standalone)
3. Auto-install via `sudo apt-get install -y docker-compose-v2`
4. Fallback: `sudo apt-get install -y docker-compose-plugin`
5. Raise clear error with install instructions if all fail

Added `_run_compose()` helper that uses the detected command for all compose operations, with timeout support.

**File:** `api/services/deployer.py` — Added `_detect_compose_cmd()`, `_compose_cmd()`, `_run_compose()` methods. Replaced all 5 hardcoded `"docker", "compose"` calls.

---

## Bug 2: Docker Socket Permission Denied

### Symptom
```json
{
    "detail": "Docker compose up failed: permission denied while trying to connect to
    the Docker daemon socket at unix:///var/run/docker.sock"
}
```

### Debugging

**Step 1: Check user groups**
```bash
$ groups oc
oc : oc adm cdrom sudo dip plugdev users lpadmin
```

**Purpose:** Check if user is in the `docker` group.
**Finding:** User `oc` is NOT in the `docker` group.

**Step 2: Verify docker works with the group**
```bash
$ sg docker -c "docker ps"
CONTAINER ID   IMAGE     COMMAND   CREATED   STATUS   PORTS   NAMES
```

**Purpose:** Test if docker access works when running under the docker group.
**Finding:** Works with `sg docker`.

### Fix

```bash
$ sudo usermod -aG docker oc
```

Then restarted the backend server under the docker group:
```bash
$ sg docker -c "/home/oc/Desktop/Agent-orchestrator/api/venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload"
```

**Note:** The group change requires either a new login session or `sg docker` to take effect. The running uvicorn process was started before the group change, so it needed a restart.

---

## Bug 3: Container Crash — `option '--port' argument missing`

### Symptom

Container starts but immediately enters a restart loop:
```bash
$ sg docker -c "docker ps -a --filter 'name=openclaw'"
STATUS: Restarting (1) 58 seconds ago

$ sg docker -c "docker logs 2821fa6806-openclaw-1 --tail 5"
error: option '--port <port>' argument missing
error: option '--port <port>' argument missing
error: option '--port <port>' argument missing
```

### Debugging

**Step 1: Check the .env file**
```bash
$ cat deployments/2821fa6806/.env
PORT=31055
OPENCLAW_GATEWAY_TOKEN=5432982c01dc30dd1fefabcc83f0a4f0
OPENROUTER_API_KEY=sk-or-v1-testkey123
```

**Purpose:** Verify PORT is set in .env.
**Finding:** `PORT=31055` is present.

**Step 2: Trace how PORT flows through docker-compose.yml**

```yaml
# Line 17 — Docker Compose substitutes ${PORT} from .env
ports:
  - "${PORT}:${PORT}"          # → "31055:31055" ✅

# Line 25 — Docker Compose substitutes ${PORT} into container env
environment:
  OPENCLAW_GATEWAY_PORT: ${PORT}  # → Container gets OPENCLAW_GATEWAY_PORT=31055 ✅

# Line 176 — Shell INSIDE the container runs:
exec su node -s /bin/sh -c "cd $$APP_DIR && node dist/index.js gateway --bind lan --port $$PORT"
```

**Purpose:** Trace the variable substitution chain.
**Finding:** The critical bug is on line 176:
- `$$PORT` in Docker Compose YAML becomes `$PORT` in the container's shell
- But the container's environment has `OPENCLAW_GATEWAY_PORT`, NOT `PORT`
- `$PORT` is empty inside the container → `--port` gets no argument → crash

**Variable flow:**
```
.env: PORT=31055
  → Docker Compose substitutes ${PORT} into:
    - ports: "31055:31055" ✅
    - environment.OPENCLAW_GATEWAY_PORT: 31055 ✅
  → Container shell: $PORT is UNSET ❌ (only $OPENCLAW_GATEWAY_PORT exists)
```

### Fix

```yaml
# docker-compose.yml line 176 — BEFORE:
exec su node -s /bin/sh -c "cd $$APP_DIR && node dist/index.js gateway --bind lan --port $$PORT"

# AFTER:
exec su node -s /bin/sh -c "cd $$APP_DIR && node dist/index.js gateway --bind lan --port $$OPENCLAW_GATEWAY_PORT"
```

**File:** `docker-compose.yml` line 176

---

## Bug 4: Container Name Conflict on Re-Launch

### Symptom
```
Container 2821fa6806-openclaw-1  Error response from daemon: Conflict.
The container name "/2821fa6806-openclaw-1" is already in use by container "e7c8d4e7..."
```

### Debugging

**Step 1: Check stale containers**
```bash
$ sg docker -c "docker ps -a --filter 'name=openclaw'"
e7c8d4e7a48c   ghcr.io/openclaw/openclaw:latest   Restarting (1) 58 seconds ago   2821fa6806-openclaw-1
```

**Purpose:** Find the conflicting container.
**Finding:** A stale container from a previous failed launch attempt was still present. Docker compose `up -d` tries to create a new container with the same name and fails.

### Fix

Added a cleanup step in `launch()` that runs `docker compose down --remove-orphans` before `up`:

```python
# api/services/deployer.py — launch() method
# Clean up any stale containers from previous attempts
await self._run_compose(
    ["-f", compose_path, "--env-file", env_path, "down", "--remove-orphans"],
    cwd=deploy_dir,
)

# Copy the latest docker-compose.yml (in case it was updated)
compose_src = PROJECT_ROOT / "docker-compose.yml"
if compose_src.exists():
    shutil.copy2(compose_src, compose_path)

# Run compose up with --force-recreate
stdout, stderr, rc = await self._run_compose(
    ["-f", compose_path, "--env-file", env_path, "up", "-d", "--force-recreate", "--remove-orphans"],
    cwd=deploy_dir,
)
```

**File:** `api/services/deployer.py` — `launch()` method

---

## Bug 5: False Success on Failed Launch

### Symptom

Server logs show:
```
Deployment 2821fa6806 launched on port 31055
POST /api/deploy/launch HTTP/1.1 200 OK
```
But the container was actually in a crash loop (Bug 3) and had a name conflict (Bug 4).

### Debugging

**Step 1: Check return code handling**

`docker compose up -d` returned rc=0 even though the container creation failed with a conflict error. The error was only in stderr.

### Fix

Added stderr error check even when rc=0:

```python
# Double-check: stderr may contain errors even with rc=0
if stderr and "error" in stderr.lower():
    error_msg = stderr.strip()
    info["status"] = "failed"
    info["error"] = error_msg
    raise RuntimeError(f"Docker compose up had errors: {error_msg}")
```

**File:** `api/services/deployer.py` — `launch()` method

---

## Verification — Full End-to-End Test

After all fixes, ran the complete flow:

### Test 1: Schema endpoint
```bash
$ curl -s http://localhost:8000/api/deploy/schema | python3 -m json.tool
# Returns: auto (PORT, TOKEN), mandatory (OPENROUTER_API_KEY), optional fields
# Result: ✅ 200 OK
```

### Test 2: Configure deployment
```bash
$ curl -s -X POST http://localhost:8000/api/deploy/configure \
  -H "Content-Type: application/json" \
  -d '{"openrouter_api_key": "sk-or-v1-testkey123"}' | python3 -m json.tool
{
    "ok": true,
    "deployment_id": "23ca3cf35d",
    "port": 35341,
    "gateway_token": "1e1727a549d082d62784b1b9265dcb3a",
    "status": "configured",
    "message": "Deployment configured. Port: 35341. Ready to launch."
}
# Result: ✅ 200 OK, deployment dir created with .env + docker-compose.yml
```

### Test 3: Launch container
```bash
$ curl -s --max-time 120 -X POST http://localhost:8000/api/deploy/launch \
  -H "Content-Type: application/json" \
  -d '{"deployment_id": "23ca3cf35d"}' | python3 -m json.tool
{
    "ok": true,
    "deployment_id": "23ca3cf35d",
    "port": 35341,
    "gateway_token": "1e1727a549d082d62784b1b9265dcb3a",
    "status": "running",
    "message": "Container launched on port 35341. Connect via ws://<host>:35341"
}
# Result: ✅ 200 OK, container running
```

### Test 4: Verify container is healthy
```bash
$ sg docker -c "docker ps --filter 'name=23ca3cf35d'"
CONTAINER ID   IMAGE                              STATUS          PORTS
bbf2d64d8702   ghcr.io/openclaw/openclaw:latest   Up 2 minutes    0.0.0.0:35341->35341/tcp

$ sg docker -c "docker logs 23ca3cf35d-openclaw-1 --tail 5"
[gateway] agent model: openrouter/x-ai/grok-code-fast-1
[gateway] listening on ws://0.0.0.0:35341 (PID 18)
[browser/service] Browser control service ready (profiles=2)
# Result: ✅ Container healthy, gateway listening on correct port
```

### Test 5: Status endpoint
```bash
$ curl -s http://localhost:8000/api/deploy/status/23ca3cf35d | python3 -m json.tool
{
    "deployment_id": "23ca3cf35d",
    "status": "running",
    "port": 35341,
    "containers": [{"State": "running", "Status": "Up 2 minutes", ...}]
}
# Result: ✅ 200 OK
```

### Test 6: Logs endpoint
```bash
$ curl -s http://localhost:8000/api/deploy/logs/23ca3cf35d | python3 -m json.tool
{
    "deployment_id": "23ca3cf35d",
    "logs": "openclaw-1  | [gateway] listening on ws://0.0.0.0:35341 ..."
}
# Result: ✅ 200 OK
```

### Test 7: List deployments
```bash
$ curl -s http://localhost:8000/api/deploy/list | python3 -m json.tool
[{"deployment_id": "23ca3cf35d", "port": 35341, "status": "running"}]
# Result: ✅ 200 OK
```

### Test 8: Stop deployment
```bash
$ curl -s -X POST http://localhost:8000/api/deploy/stop \
  -H "Content-Type: application/json" \
  -d '{"deployment_id": "23ca3cf35d"}' | python3 -m json.tool
{
    "ok": true,
    "deployment_id": "23ca3cf35d",
    "status": "stopped",
    "message": "Container stopped."
}
# Result: ✅ 200 OK
```

---

## Files Modified

| File | Change |
|------|--------|
| `api/services/deployer.py` | Added `_detect_compose_cmd()`, `_compose_cmd()`, `_run_compose()`. Replaced all hardcoded `docker compose` calls. Added stale cleanup, force-recreate, stderr error check. |
| `docker-compose.yml` | Line 176: Changed `$$PORT` to `$$OPENCLAW_GATEWAY_PORT` |

## System Changes

| Change | Command | Purpose |
|--------|---------|---------|
| Install Docker Compose v2 | `sudo apt-get install -y docker-compose-v2` | Provides `docker compose` subcommand |
| Add user to docker group | `sudo usermod -aG docker oc` | Allows non-root Docker access |
| Start server with docker group | `sg docker -c "uvicorn main:app --reload"` | Server process inherits docker group |

## Prevention

1. **Always start the dev server with `--reload`** so code changes are picked up automatically
2. **Start the server with docker group access** — use `sg docker -c "..."` or log out/in after adding to docker group
3. **The deployer now auto-detects** the compose command and attempts auto-install if missing
4. **The deployer now cleans up** stale containers before launching, preventing name conflicts
5. **The deployer now checks stderr** for errors even when docker compose returns rc=0
