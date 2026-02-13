# Bug Fix: "Deploy failed: Not Found" (404) on Deploy Agent Page

**Date:** 2026-02-10  
**Status:** Resolved  
**Severity:** Blocker — Deploy Agent feature completely non-functional

---

## 1. Symptom

User fills in OpenRouter API key on the **Deploy Agent** page in the Aether UI, clicks **Deploy Agent**, and gets:

```
Deploy failed: Not Found
```

The error appears as a red toast notification in the bottom-right corner.

---

## 2. Debugging Steps

### Step 1: Identify the error source

The error message "Not Found" is a standard HTTP **404** response. This means the frontend is calling an endpoint that the backend doesn't recognize.

**Frontend call chain:**
```
DeployAgent.tsx → handleDeploy()
  → configureDeploy({ openrouter_api_key: "sk-or-v1-..." })
    → api.post('/deploy/configure', req)
      → axios POST http://localhost:8000/api/deploy/configure
```

### Step 2: Verify frontend URL construction

Checked `ui/src/api.ts`:
```typescript
const API_BASE_URL = 'http://localhost:8000/api';
const api = axios.create({ baseURL: API_BASE_URL });

// Deploy call:
export const configureDeploy = async (req) => {
    const response = await api.post('/deploy/configure', req);
    return response.data;
};
```

**Full URL:** `http://localhost:8000/api` + `/deploy/configure` = `http://localhost:8000/api/deploy/configure` ✅

### Step 3: Verify backend router prefix

Checked `api/routers/deploy.py`:
```python
router = APIRouter(prefix="/api/deploy", tags=["deploy"])

@router.post("/configure")
async def configure_deployment(req: DeployConfigureRequest):
    ...
```

**Full route:** `/api/deploy` + `/configure` = `/api/deploy/configure` ✅

**URL match confirmed** — frontend and backend paths are identical.

### Step 4: Check if deploy router is registered

Checked `api/main.py`:
```python
from routers import auth, agents, missions, chat, metrics, remote, deploy
...
app.include_router(deploy.router)  # ✅ Present
```

### Step 5: Check if server is running stale code

```bash
$ ps aux | grep uvicorn
oc  24759  ... /api/venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

**Key finding:** Server was started **without `--reload`** flag. This means it was running the code from when it was last started — **before** the deploy router and deployer service were created.

The deploy router files were created in this session:
- `api/routers/deploy.py` — NEW file
- `api/services/deployer.py` — NEW file
- `api/main.py` — MODIFIED (added `deploy` import and `app.include_router(deploy.router)`)

But the running server process (PID 24759) was started before these changes, so it had no knowledge of the `/api/deploy/*` endpoints.

### Step 6: Confirm with direct curl test

```bash
$ curl -s http://localhost:8000/api/deploy/schema
{"detail":"Not Found"}
```

**Confirmed: 404.** The endpoint doesn't exist in the running server.

### Step 7: Verify imports are clean (no syntax/import errors)

```bash
$ cd api && venv/bin/python -c "from routers import deploy; print('OK'); from services.deployer import deployer; print('OK')"
deploy router OK
deployer service OK
```

No import errors — the code is valid, just not loaded by the running server.

---

## 3. Root Cause

**The FastAPI server was running without `--reload` and was started before the deploy router was created.** The new files (`api/routers/deploy.py`, `api/services/deployer.py`) and the modified `api/main.py` were never loaded by the running process.

```
Timeline:
  1. Server started (PID 24759) — no deploy router exists yet
  2. deploy.py and deployer.py created in this coding session
  3. main.py modified to register deploy router
  4. User clicks Deploy → 404 because server is still running old code
```

---

## 4. Fix

Killed the stale server and restarted with `--reload`:

```bash
# Kill stale server
$ kill 24759

# Restart with --reload for auto-reloading on file changes
$ cd /home/oc/Desktop/Agent-orchestrator/api
$ venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

---

## 5. Verification

### Test 1: Schema endpoint
```bash
$ curl -s http://localhost:8000/api/deploy/schema | python3 -m json.tool
{
    "auto": {
        "PORT": {"description": "Gateway port"},
        "OPENCLAW_GATEWAY_TOKEN": {"description": "Gateway auth token"}
    },
    "mandatory": {
        "OPENROUTER_API_KEY": {"description": "OpenRouter API key for LLM access", ...}
    },
    "optional": { ... }
}
```
**Result:** ✅ 200 OK with correct schema

### Test 2: Configure endpoint
```bash
$ curl -s -X POST http://localhost:8000/api/deploy/configure \
  -H "Content-Type: application/json" \
  -d '{"openrouter_api_key": "sk-or-v1-test123"}' | python3 -m json.tool
{
    "ok": true,
    "deployment_id": "474f5f3838",
    "port": 48658,
    "gateway_token": "98b71b39f61df81b029d260abb305b65",
    "status": "configured",
    "message": "Deployment configured. Port: 48658. Ready to launch."
}
```
**Result:** ✅ 200 OK, deployment configured with auto-generated PORT and TOKEN

### Test 3: Generated .env file
```bash
$ cat deployments/474f5f3838/.env
PORT=48658
OPENCLAW_GATEWAY_TOKEN=98b71b39f61df81b029d260abb305b65
OPENROUTER_API_KEY=sk-or-v1-test123
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_USER_ID=
WHATSAPP_NUMBER=
```
**Result:** ✅ .env correctly generated with auto values + user input

### Test 4: Deployment directory structure
```bash
$ ls -la deployments/474f5f3838/
.env                 ← Generated from customer input
docker-compose.yml   ← Copied from project root (standard YAML)
config/              ← Will be mounted as /home/node/.openclaw
workspace/           ← Will be mounted as /home/node/.openclaw/workspace
```
**Result:** ✅ Correct structure

---

## 6. Answer to User's Question: "Do we need a model for OpenRouter?"

**No.** The OpenRouter API key is sufficient. The model is already hardcoded in the `docker-compose.yml` shell script:

```json
"model": {
    "primary": "openrouter/x-ai/grok-code-fast-1"
}
```

The YAML dynamically adds fallback models if `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` are provided:
- Anthropic key → adds `anthropic/claude-opus-4-5` as fallback
- OpenAI key → adds `openai/gpt-5.2` as fallback

The user does **not** need to specify a model — it's handled automatically by the YAML's startup script.

---

## 7. Prevention

- **Always use `--reload`** when running the dev server: `uvicorn main:app --reload`
- After adding new router files, verify the server has reloaded by checking logs for `WARNING: WatchFiles detected changes`
- If not using `--reload`, manually restart the server after code changes

---

## 8. Files Involved

| File | Role |
|------|------|
| `api/routers/deploy.py` | Deploy router (new, wasn't loaded) |
| `api/services/deployer.py` | Deployer service (new, wasn't loaded) |
| `api/main.py` | Router registration (modified, wasn't reloaded) |
| `ui/src/api.ts` | Frontend API calls (correct, no issue) |
| `ui/src/components/DeployAgent.tsx` | Deploy UI (correct, no issue) |
