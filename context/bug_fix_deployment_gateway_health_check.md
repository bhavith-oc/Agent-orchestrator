# Bug Fix: Deployment Gateway Health Check Failure

**Date:** 2026-02-11  
**Severity:** High — blocked entire onboarding deployment flow  
**Status:** RESOLVED

---

## Symptom

After the config form submission in the onboarding flow, the `DeploymentProgress` component showed:
> "Deployment encountered an issue. Check the logs above for details."

The deployment progress page would get stuck at the "Authenticating Gateway" step and eventually time out after 3 minutes.

---

## Investigation

### Step 1: Check backend logs

```bash
# Command: Check running backend output
# Output showed repeated gateway-health calls all returning 200 but never completing:
curl -s http://localhost:8000/api/deploy/gateway-health/b0c6f5c1dc | python3 -m json.tool
```

**Output:**
```json
{
    "healthy": false,
    "http_ok": true,
    "ws_ok": false,
    "port": 38946,
    "detail": "HTTP 200 | WS connect rejected: INVALID_REQUEST: invalid connect params: must have required property 'minProtocol'; must have required property 'maxProtocol'; must have required property 'client'"
}
```

**Finding:** HTTP probe passed (gateway is up), but WebSocket handshake was rejected because the connect frame was missing required fields.

### Step 2: Compare with working RemoteJasonClient handshake

```bash
# Read the working handshake in RemoteJasonClient._send_connect()
# File: api/services/remote_jason.py lines 455-494
```

The working handshake requires:
- `minProtocol: 3`
- `maxProtocol: 3`
- `client: { id, version, platform, mode, instanceId }`
- `role: "operator"`
- `scopes: ["operator.admin"]`
- `auth: { token: "<gateway_token>" }`

The broken gateway-health endpoint was sending:
```json
{ "token": "<token>", "session": "agent:main:main" }
```

### Step 3: Fix #1 — Use full OpenClaw connect protocol

Updated `api/routers/deploy.py` gateway-health endpoint to send the complete connect frame matching `RemoteJasonClient._send_connect()`.

**Result after fix #1:**
```bash
curl -s http://localhost:8000/api/deploy/gateway-health/b0c6f5c1dc | python3 -m json.tool
```
```json
{
    "healthy": false,
    "http_ok": true,
    "ws_ok": false,
    "detail": "HTTP 200 | WS connect rejected: INVALID_REQUEST: invalid connect params: at /client/id: must be equal to constant; at /client/id: must match a schema in anyOf"
}
```

**Finding:** Protocol fields are now correct, but `client.id` must be a specific constant the gateway recognizes.

### Step 4: Brute-force discover valid client IDs

```bash
# Python script to test all plausible client IDs against the gateway
# Tested: openclaw-cli, openclaw-web, openclaw-vscode, openclaw-control-ui,
#         control-ui, cli, vscode, web, openclaw-desktop, desktop
```

**Results:**
```
openclaw-cli                   -> ok=False  invalid connect params: at /client/id
openclaw-web                   -> ok=False  invalid connect params: at /client/id
openclaw-vscode                -> ok=False  invalid connect params: at /client/id
openclaw-control-ui            -> ok=False  origin not allowed
control-ui                     -> ok=False  invalid connect params: at /client/id
cli                            -> ok=True   OK
vscode                         -> ok=False  invalid connect params: at /client/id
web                            -> ok=False  invalid connect params: at /client/id
openclaw-desktop               -> ok=False  invalid connect params: at /client/id
desktop                        -> ok=False  invalid connect params: at /client/id
```

**Finding:** Only `"cli"` is accepted as `client.id` by local OpenClaw containers.

### Step 5: Fix #2 — Use client.id="cli"

Updated `api/routers/deploy.py` gateway-health endpoint: `client.id` changed from `"health-check"` to `"cli"`.

**Result after fix #2:**
```bash
curl -s http://localhost:8000/api/deploy/gateway-health/b0c6f5c1dc | python3 -m json.tool
```
```json
{
    "healthy": true,
    "http_ok": true,
    "ws_ok": true,
    "port": 38946,
    "detail": "HTTP 200 | WS handshake OK"
}
```

### Step 6: Fix deploy-chat connect (same client.id issue)

The `DeploymentChatManager` also used `RemoteJasonClient` with default `client.id="gateway-client"` which would fail for local containers.

- Made `gateway_client_id` a configurable parameter in `RemoteJasonClient.__init__()`
- Default remains `"gateway-client"` (works for remote connections)
- `DeploymentChatManager.connect()` now passes `gateway_client_id="cli"` for local containers

**Verified:**
```bash
curl -s -X POST http://localhost:8000/api/deploy-chat/connect \
  -H "Content-Type: application/json" \
  -d '{"deployment_id":"b0c6f5c1dc"}' | python3 -m json.tool
```
```json
{
    "connected": true,
    "deployment_id": "b0c6f5c1dc",
    "session_name": "Neural Phoenix",
    "port": 38946,
    "protocol": 3,
    "server": { "version": "dev", "host": "bc33003a1e40" }
}
```

### Step 7: Fix false positive error detection in frontend

Container logs contained gateway WS rejection messages with the word "error" in benign contexts (e.g., `"invalid connect params"`). The `DeploymentProgress` component's error detection was:

```js
// OLD — too broad, matched gateway WS rejection messages
if (logText.includes('error') && (logText.includes('exit') || logText.includes('fatal')))
```

Changed to a tighter regex that only matches actual container crash patterns:

```js
// NEW — only matches real container failures
const hasFatalError = /exited with code [1-9]|fatal error|oom|killed|cannot start/i.test(logResult.logs || '')
```

---

## Root Causes

| # | Root Cause | Impact | Fix |
|---|-----------|--------|-----|
| 1 | Gateway-health WS handshake missing `minProtocol`, `maxProtocol`, `client` fields | Gateway rejected all health checks → timeout | Use full OpenClaw connect protocol |
| 2 | Gateway-health used `client.id="health-check"` instead of `"cli"` | Gateway rejected: "must be equal to constant" | Changed to `"cli"` |
| 3 | `RemoteJasonClient` hardcoded `client.id="gateway-client"` | Deploy-chat connect would fail for local containers | Made configurable, deploy-chat uses `"cli"` |
| 4 | Frontend error detection too broad (`'error' && 'exit'`) | Could false-positive on gateway WS rejection logs | Tightened to regex matching actual crash patterns |

---

## Files Changed

| File | Change |
|------|--------|
| `api/routers/deploy.py` | Fixed `gateway-health` endpoint: full OpenClaw connect protocol with `client.id="cli"`, proper response loop skipping events |
| `api/services/remote_jason.py` | Added `gateway_client_id` parameter to `__init__()`, used in `_send_connect()` instead of hardcoded `"gateway-client"` |
| `api/services/deployment_chat.py` | Pass `gateway_client_id="cli"` when creating `RemoteJasonClient` for local container connections |
| `ui/src/components/onboarding/DeploymentProgress.tsx` | Tightened error detection regex to avoid false positives from gateway WS rejection messages |

---

## Commands Used (Full Session)

```bash
# 1. Check backend logs for error patterns
# (Viewed running backend output via command_status)

# 2. Test gateway health endpoint
curl -s http://localhost:8000/api/deploy/gateway-health/b0c6f5c1dc | python3 -m json.tool
# Output: healthy=false, ws_ok=false, "must have required property 'minProtocol'"

# 3. Check container status
docker ps --format '{{.ID}} {{.Names}} {{.Ports}}'
# Output: 4 containers running on ports 38946, 23637, 14015, 57894

# 4. Check container logs for error details
docker logs bc33003a1e40 2>&1 | tail -30
# Output: "closed before connect" with code=1008 "invalid connect params"

# 5. Read OpenClaw gateway config inside container
docker exec bc33003a1e40 cat /home/node/.openclaw/openclaw.json
# Output: gateway token confirmed matching, mode=local, auth=token

# 6. After fix #1 — test with full protocol but wrong client.id
curl -s http://localhost:8000/api/deploy/gateway-health/b0c6f5c1dc | python3 -m json.tool
# Output: healthy=false, "at /client/id: must be equal to constant"

# 7. Brute-force test all client IDs via Python script
# (Tested 10 client IDs, only "cli" returned ok=True)

# 8. After fix #2 — verify gateway health
curl -s http://localhost:8000/api/deploy/gateway-health/b0c6f5c1dc | python3 -m json.tool
# Output: {"healthy": true, "http_ok": true, "ws_ok": true, "detail": "HTTP 200 | WS handshake OK"}

# 9. Test deploy-chat connect with fixed client.id
curl -s -X POST http://localhost:8000/api/deploy-chat/connect \
  -H "Content-Type: application/json" \
  -d '{"deployment_id":"b0c6f5c1dc"}' | python3 -m json.tool
# Output: {"connected": true, "session_name": "Neural Phoenix", "protocol": 3}

# 10. Backend restart
kill $(ps aux | grep "python3 main.py" | grep -v grep | awk '{print $2}')
cd api && venv/bin/python3 main.py

# 11. Frontend build verification
cd ui && npx vite build
# Output: ✓ 2182 modules transformed, built in 8.43s, 0 errors

# 12. Check container logs for error detection false positives
curl -s http://localhost:8000/api/deploy/logs/b0c6f5c1dc?tail=30
# Output: WS rejection messages containing "error" in benign context
```

---

## Verification

After all fixes:
- ✅ `GET /api/deploy/gateway-health/{id}` returns `healthy: true`
- ✅ `POST /api/deploy-chat/connect` returns `connected: true` with protocol 3
- ✅ Frontend build passes (2182 modules, 0 errors)
- ✅ Backend starts cleanly with remote Jason connected
- ✅ Error detection no longer false-positives on gateway WS rejection logs
