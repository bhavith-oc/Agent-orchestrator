# Bug Fix: Deploy Agent — Deployment Persistence & Container Connectivity

**Date:** 2026-02-10
**Status:** Resolved
**Severity:** High — deployments lost on server restart, containers appear inaccessible

---

## Issues Reported

1. **Previous deployments not listed** — After server restart, the Deploy Agent page doesn't show the earlier OpenClaw deployment
2. **Current container not accessible** — `ws://localhost:18419` appears unreachable

---

## Diagnosis

### Step 1: Check running Docker containers

**Command:**
```bash
$ sg docker -c "docker ps -a --filter 'name=openclaw' --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'"
```

**Output:**
```
NAMES                   STATUS          PORTS
e2263cc644-openclaw-1   Up 4 minutes    0.0.0.0:18419->18419/tcp, [::]:18419->18419/tcp
1959c1bfb1-openclaw-1   Up 19 minutes   0.0.0.0:10188->10188/tcp, [::]:10188->10188/tcp
```

**Finding:** Both containers are running and healthy. Docker is fine.

### Step 2: Check deployment directories on disk

**Command:**
```bash
$ ls -la /home/oc/Desktop/Agent-orchestrator/deployments/
```

**Output:**
```
drwxrwxr-x  4 oc docker 4096 Feb 10 22:14 1959c1bfb1
drwxrwxr-x  4 oc docker 4096 Feb 10 21:29 23ca3cf35d
drwxrwxr-x  4 oc docker 4096 Feb 10 23:00 e2263cc644
```

**Finding:** 3 deployment directories exist on disk with .env files and docker-compose.yml.

### Step 3: Check what the backend API returns

**Command:**
```bash
$ curl -s http://localhost:8000/api/deploy/list | python3 -m json.tool
```

**Output:**
```json
[
    {
        "deployment_id": "e2263cc644",
        "port": 18419,
        "status": "running",
        "deploy_dir": "/home/oc/Desktop/Agent-orchestrator/deployments/e2263cc644"
    }
]
```

**Finding:** Only 1 deployment returned! The other 2 (`1959c1bfb1` and `23ca3cf35d`) are missing.

### Step 4: Identify root cause

**Root cause:** The `Deployer` class tracks deployments in an **in-memory dict** (`self._active_deployments`). When the backend server restarts (which happens on every `--reload` code change), the dict is reset to empty. Only deployments created in the current server session are tracked.

```python
# api/services/deployer.py — Deployer.__init__()
class Deployer:
    def __init__(self):
        self._active_deployments: dict[str, dict] = {}  # ← Lost on restart!
```

The `list_deployments()` method only reads from this dict:
```python
def list_deployments(self) -> list[dict]:
    return [
        {"deployment_id": k, "port": v.get("port"), ...}
        for k, v in self._active_deployments.items()
    ]
```

### Step 5: Verify container WebSocket connectivity

**Command:**
```bash
$ python3 -c "
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(3)
s.connect(('localhost', 18419))
print('TCP connection to localhost:18419 SUCCESS')
s.close()
"
```

**Output:**
```
TCP connection to localhost:18419 SUCCESS
```

**Command (WebSocket handshake):**
```bash
$ /home/oc/.../venv/bin/python -c "
import asyncio, websockets, json
async def test():
    async with websockets.connect('ws://localhost:18419', open_timeout=5) as ws:
        msg = {'jsonrpc': '2.0', 'method': 'connect',
               'params': {'token': 'fc98bccf152b4333a3e1c8c1bb6b27f2', 'client': 'test'}, 'id': 1}
        await ws.send(json.dumps(msg))
        resp = await asyncio.wait_for(ws.recv(), timeout=5)
        print('WS Response:', resp)
asyncio.run(test())
"
```

**Output:**
```
WS connected OK. Response type: event, event: connect.challenge
```

**Finding:** Container IS accessible. TCP port open, WebSocket handshake succeeds with correct token. The "not accessible" issue was likely because the UI wasn't showing the deployment (due to the persistence bug), so the user couldn't find the connection details.

---

## Fix: Add Deployment Persistence via Disk Scanning

### Implementation

Added `restore_deployments()` method to the `Deployer` class that:

1. Scans the `deployments/` directory for subdirectories
2. Reads each deployment's `.env` file to recover `PORT` and `OPENCLAW_GATEWAY_TOKEN`
3. Checks Docker via `docker compose ps --format json` to determine if the container is `running` or `stopped`
4. Populates `self._active_deployments` with the recovered state
5. Uses a `_restored` flag to ensure it only runs once per server session

**File:** `api/services/deployer.py`

```python
async def restore_deployments(self):
    """Scan deployments/ directory and restore tracking state."""
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
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line.startswith("PORT="):
                port = int(line.split("=", 1)[1])
            elif line.startswith("OPENCLAW_GATEWAY_TOKEN="):
                token = line.split("=", 1)[1]

        if not port:
            continue

        # Check if container is actually running via docker compose ps
        status = "stopped"
        cmd = await self._compose_cmd()
        proc = await asyncio.create_subprocess_exec(
            *cmd, "-f", str(compose_path), "ps", "--format", "json",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            cwd=str(entry),
        )
        stdout_bytes, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
        for line in stdout_bytes.decode().strip().split("\n"):
            if line.strip():
                container = json.loads(line)
                if container.get("State") == "running":
                    status = "running"
                    break

        info = {
            "deployment_id": deployment_id,
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
```

### Router Integration

Added `await deployer.restore_deployments()` call at the start of every deploy router endpoint:

**File:** `api/routers/deploy.py`

```python
@router.get("/list")
async def list_deployments():
    await deployer.restore_deployments()  # ← Added
    return deployer.list_deployments()

# Same for: /schema, /configure, /launch, /stop, /status/{id}, /logs/{id}
```

### Also: Moved `import json` to top level

Removed the inline `import json` inside `get_status()` since it's now needed at module level for `restore_deployments()`.

---

## Verification

### Test 1: Deployment list after server restart

**Command:**
```bash
$ curl -s http://localhost:8000/api/deploy/list | python3 -m json.tool
```

**Output:**
```json
[
    {"deployment_id": "e2263cc644", "port": 18419, "status": "running"},
    {"deployment_id": "23ca3cf35d", "port": 35341, "status": "stopped"},
    {"deployment_id": "1959c1bfb1", "port": 10188, "status": "running"}
]
```

**Result:** All 3 deployments restored with correct statuses.

### Test 2: Server logs confirm restore

```
2026-02-10 23:16:02,110 [INFO] services.deployer: Detected: docker compose (v2 plugin)
2026-02-10 23:16:02,345 [INFO] services.deployer: Restored deployment e2263cc644 (port=18419, status=running)
2026-02-10 23:16:02,532 [INFO] services.deployer: Restored deployment 23ca3cf35d (port=35341, status=stopped)
2026-02-10 23:16:02,723 [INFO] services.deployer: Restored deployment 1959c1bfb1 (port=10188, status=running)
```

### Test 3: Full deploy cycle (configure + launch + verify + stop)

```bash
# Configure
$ curl -s -X POST http://localhost:8000/api/deploy/configure \
  -H "Content-Type: application/json" \
  -d '{"openrouter_api_key": "sk-or-v1-testkey-curl-test"}'
→ {"ok": true, "deployment_id": "0b7a3361be", "port": 30163, "status": "configured"}

# Launch
$ curl -s --max-time 120 -X POST http://localhost:8000/api/deploy/launch \
  -H "Content-Type: application/json" \
  -d '{"deployment_id": "0b7a3361be"}'
→ {"ok": true, "status": "running", "port": 30163}

# Verify container running
$ sg docker -c "docker ps --filter 'name=0b7a3361be'"
→ STATUS: Up About a minute, PORTS: 0.0.0.0:30163->30163/tcp

# Verify token match
$ sg docker -c "docker exec 0b7a3361be-openclaw-1 cat /home/node/.openclaw/openclaw.json" | ...
→ Container token: b8ec3a29d68b8fb8cea5dc0c8ab18741
→ .env token:      b8ec3a29d68b8fb8cea5dc0c8ab18741
→ MATCH ✅

# Stop
$ curl -s -X POST http://localhost:8000/api/deploy/stop \
  -H "Content-Type: application/json" \
  -d '{"deployment_id": "0b7a3361be"}'
→ {"ok": true, "status": "stopped"}
```

### Test 4: All API endpoints verified

| Endpoint | Method | Status | Result |
|----------|--------|--------|--------|
| `/api/deploy/schema` | GET | 200 | Returns auto/mandatory/optional field definitions |
| `/api/deploy/list` | GET | 200 | Returns all deployments (restored + new) |
| `/api/deploy/configure` | POST | 200 | Creates deployment dir, .env, docker-compose.yml |
| `/api/deploy/launch` | POST | 200 | Starts container, verifies running |
| `/api/deploy/status/{id}` | GET | 200 | Returns container state from Docker |
| `/api/deploy/logs/{id}` | GET | 200 | Returns container log output |
| `/api/deploy/stop` | POST | 200 | Stops container via docker compose down |

### Test 5: WebSocket connectivity confirmed

```bash
$ python3 -c "... websockets.connect('ws://localhost:18419') ..."
→ WS connected OK. Response type: event, event: connect.challenge
```

---

## Files Modified

| File | Change |
|------|--------|
| `api/services/deployer.py` | Added `restore_deployments()` method, moved `import json` to top level, removed inline import |
| `api/routers/deploy.py` | Added `await deployer.restore_deployments()` to all 7 endpoints |

## Root Cause Summary

The deployer service tracked deployments **only in-memory**. Every server restart (including `--reload` triggered by code changes) wiped the tracking dict. The fix scans the `deployments/` directory on first API access, reads `.env` files to recover port/token, and checks Docker to determine running status. This makes deployments survive any number of server restarts.
