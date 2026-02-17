# Feature Session — Feb 15, 2026 (Part 2)

> Comprehensive documentation for 4 feature requests:
> 1. Google Auth as default login
> 2. Agent Pool — full env values + OpenClaw URL
> 3. Master Node persistence + revoke
> 4. Orchestrate — expert agents investigation + mission board linking

---

## 1. Google Auth as Default Login

### 1.1 Problem Statement

The user wants Google Auth to be the **default and only** login method for `/app`, restricted to `bhavith.patnam@oneconvergence.com`. It must be easy to enable/disable temporarily.

### 1.2 Architecture

The system uses a **three-layer** approach:

| Layer | Component | Purpose |
|-------|-----------|---------|
| Backend config | `api/config.py` | `AUTH_REQUIRE_GOOGLE`, `GOOGLE_ALLOWED_EMAILS`, `GOOGLE_CLIENT_ID` |
| Backend enforcement | `api/routers/auth.py` | Blocks password login when flag on; checks email allowlist on Google login |
| Frontend detection | `OnboardingFlow.tsx` | Fetches `/api/auth/config` to know which auth modes are available |

### 1.3 Changes Made

#### `ui/src/components/onboarding/OnboardingFlow.tsx`

**Change 1: Import `useEffect` and `fetchAuthConfig`**
```typescript
import { useState, useEffect, lazy, Suspense } from 'react'
import { ..., fetchAuthConfig, ... } from '../../api'
```

**Change 2: Add state for Google auth enforcement**
```typescript
const [googleRequired, setGoogleRequired] = useState(false)
const [isGoogleAuthed, setIsGoogleAuthed] = useState(false)

// Fetch auth config from backend to know if Google auth is mandatory
useEffect(() => {
    fetchAuthConfig().then(cfg => {
        setGoogleRequired(cfg.google_required)
        if (cfg.google_required && !HAS_GOOGLE) {
            setAuthError('Google authentication is required but VITE_GOOGLE_CLIENT_ID is not configured.')
        }
    }).catch(() => { /* ignore */ })
}, [])
```

**Reasoning:** The frontend now queries the backend to know if Google auth is mandatory. This means the backend is the single source of truth — no need to change frontend code to toggle auth modes.

**Change 3: Track Google auth success**
```typescript
const handleGoogleSuccess = async (accessToken: string) => {
    // ... existing code ...
    setIsGoogleAuthed(true)  // NEW: track that user authenticated via Google
    setPhase(SetupPhase.INSTALLING)
}
```

**Change 4: Block "Dashboard" shortcut when Google auth required but not authenticated**
```typescript
{phase === SetupPhase.CONFIGURATION && (!googleRequired || isGoogleAuthed) && (
    <button onClick={() => onComplete()} ...>Dashboard</button>
)}
```

**Reasoning:** When `googleRequired=true`, the user cannot skip to the dashboard without first authenticating via Google. This prevents bypassing auth.

### 1.4 How to Enable Google Auth (Step-by-Step)

#### Prerequisites
1. A Google Cloud Console project with OAuth 2.0 credentials
2. The OAuth Client ID (Web application type)

#### Enable Google Auth
```bash
# 1. Set the Google Client ID in backend .env
echo 'GOOGLE_CLIENT_ID=your-client-id-here' >> /root/bhavith/Agent-orchestrator/Agent-orchestrator/api/.env

# 2. Set AUTH_REQUIRE_GOOGLE=true to make it mandatory
sed -i 's/AUTH_REQUIRE_GOOGLE=false/AUTH_REQUIRE_GOOGLE=true/' /root/bhavith/Agent-orchestrator/Agent-orchestrator/api/.env

# 3. Set the same Client ID in frontend .env
echo 'VITE_GOOGLE_CLIENT_ID=your-client-id-here' >> /root/bhavith/Agent-orchestrator/Agent-orchestrator/ui/.env

# 4. Restart both services
systemctl restart aether-backend
systemctl restart aether-frontend
```

#### Verify it's working
```bash
# Should show google_enabled=true, google_required=true
curl -s http://localhost:8000/api/auth/config
# Expected: {"google_enabled":true,"google_required":true,"legacy_login_enabled":false}

# Password login should be blocked
curl -s -X POST http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"Oc123"}'
# Expected: {"detail":"Username/password login is disabled. Please use Google Sign-In."}
```

#### Disable Google Auth Temporarily
```bash
# Option A: Disable the requirement (keep Google as an option but allow password too)
sed -i 's/AUTH_REQUIRE_GOOGLE=true/AUTH_REQUIRE_GOOGLE=false/' /root/bhavith/Agent-orchestrator/Agent-orchestrator/api/.env
systemctl restart aether-backend

# Option B: Remove Google entirely (revert to password-only)
sed -i 's/GOOGLE_CLIENT_ID=.*/GOOGLE_CLIENT_ID=/' /root/bhavith/Agent-orchestrator/Agent-orchestrator/api/.env
sed -i 's/VITE_GOOGLE_CLIENT_ID=.*/VITE_GOOGLE_CLIENT_ID=/' /root/bhavith/Agent-orchestrator/Agent-orchestrator/ui/.env
systemctl restart aether-backend
systemctl restart aether-frontend
```

#### Re-enable Google Auth
```bash
sed -i 's/AUTH_REQUIRE_GOOGLE=false/AUTH_REQUIRE_GOOGLE=true/' /root/bhavith/Agent-orchestrator/Agent-orchestrator/api/.env
systemctl restart aether-backend
```

### 1.5 Configuration Reference

| Variable | File | Default | Description |
|----------|------|---------|-------------|
| `GOOGLE_CLIENT_ID` | `api/.env` | `""` | Google OAuth Client ID. Empty = Google auth disabled |
| `AUTH_REQUIRE_GOOGLE` | `api/.env` | `false` | When `true`, password login is blocked |
| `GOOGLE_ALLOWED_EMAILS` | `api/.env` | `bhavith.patnam@oneconvergence.com` | Comma-separated email allowlist. Empty = allow all |
| `VITE_GOOGLE_CLIENT_ID` | `ui/.env` | `""` | Same Client ID for frontend. Must match backend |

### 1.6 Testing Results

| Test | Command | Result |
|------|---------|--------|
| Auth config (flag off) | `curl /api/auth/config` | `{"google_enabled":false,"google_required":false,"legacy_login_enabled":true}` ✅ |
| Login works (flag off) | `curl -X POST /api/auth/login` | Returns JWT token ✅ |
| Login blocked (flag on) | Set `AUTH_REQUIRE_GOOGLE=true`, restart | `{"detail":"Username/password login is disabled..."}` ✅ |
| Auth config (flag on) | `curl /api/auth/config` | `{"google_required":true,"legacy_login_enabled":false}` ✅ |
| Frontend compiles | `journalctl -u aether-frontend` | No errors ✅ |

---

## 2. Agent Pool — Full Env Values + OpenClaw URL

### 2.1 Problem Statement

When expanding a container card in Agent Pool, sensitive values like API keys were shown as `sk-or-v1...5d83` (masked). The user wants to see **full values** when the eye icon is clicked. Also wants a clickable URL to open the OpenClaw UI for each container.

### 2.2 Root Cause Analysis

**Why values were masked:** The backend `deployer.get_info()` method masks sensitive values before returning them. The `/api/deploy/info/{id}` endpoint was stripping the raw values:
```python
# OLD CODE — removed raw config
info.pop("env_config_raw", None)
return info
```

**Fix:** Return both masked and full values:
```python
# NEW CODE — include both
info["env_config_full"] = info.pop("env_config_raw", {})
return info
```

### 2.3 Changes Made

#### `api/routers/deploy.py` — Return full env values
```python
@router.get("/info/{deployment_id}")
async def get_deployment_info(deployment_id: str):
    info = deployer.get_info(deployment_id)
    info["env_config_full"] = info.pop("env_config_raw", {})  # Expose full values
    return info
```

#### `ui/src/api.ts` — Updated interface
```typescript
export interface DeployDetailInfo {
    // ... existing fields ...
    env_config: Record<string, string>;       // Masked sensitive values
    env_config_full: Record<string, string>;   // Full unmasked values
}
```

#### `ui/src/components/Agents.tsx` — 4 changes

**Change 1: Use full values for editing**
```typescript
const startEditEnv = () => {
    setEnvEdits({ ...(deployDetail.env_config_full || deployDetail.env_config) })
}
```

**Change 2: Compare against full values when saving**
```typescript
const fullConfig = deployDetail.env_config_full || deployDetail.env_config
for (const [key, val] of Object.entries(envEdits)) {
    if (val !== fullConfig[key]) { changes[key] = val }
}
```

**Change 3: Display full values (with show/hide toggle for sensitive)**
```typescript
{Object.entries(editingEnv ? envEdits : (deployDetail.env_config_full || deployDetail.env_config)).map(([key, val]) => {
    const displayVal = editingEnv ? val : (isSensitive && !isShown ? '••••••••' : val || '(empty)')
    // ...
})}
```

**Change 4: Add OpenClaw UI link**
```tsx
<a
    href={`http://localhost:${deployDetail.port}/?token=${deployDetail.gateway_token}`}
    target="_blank"
    rel="noopener noreferrer"
    className="bg-[#0f1117] rounded-xl p-3 border border-primary/20 hover:border-primary/50 ..."
>
    <p className="text-[10px] ...">OpenClaw UI</p>
    <p className="text-xs text-primary font-bold ...">Open in Browser →</p>
</a>
```

### 2.4 Testing — End-to-End Env Update

```bash
# Step 1: Read current value
curl -s http://localhost:8000/api/deploy/info/46bb451534 | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(f'masked: {d[\"env_config\"][\"OPENCLAW_GATEWAY_TOKEN\"]}')
print(f'full:   {d[\"env_config_full\"][\"OPENCLAW_GATEWAY_TOKEN\"]}')
"
# Output:
# masked: 3vMRPCr2...L3U8
# full:   3vMRPCr2UQRW8x1sGAzE4QPAgVmAL3U8

# Step 2: Update DEPLOY_NAME
curl -s -X PUT http://localhost:8000/api/deploy/update-env \
  -H 'Content-Type: application/json' \
  -d '{"deployment_id":"46bb451534","updates":{"DEPLOY_NAME":"Sapphire Helix Updated"}}'
# Output: {"ok":true,"updated_keys":["DEPLOY_NAME"],"message":"Environment updated..."}

# Step 3: Verify update
curl -s http://localhost:8000/api/deploy/info/46bb451534 | python3 -c "
import sys,json; print(json.load(sys.stdin)['env_config_full']['DEPLOY_NAME'])
"
# Output: Sapphire Helix Updated

# Step 4: Revert
curl -s -X PUT http://localhost:8000/api/deploy/update-env \
  -H 'Content-Type: application/json' \
  -d '{"deployment_id":"46bb451534","updates":{"DEPLOY_NAME":"Sapphire Helix"}}'
# Output: {"ok":true}
```

### 2.5 Debugging Guide

**Q: Values still show masked after fix?**
- Hard refresh the browser (Ctrl+Shift+R)
- Check the API response: `curl http://localhost:8000/api/deploy/info/<id>` — verify `env_config_full` key exists
- If `env_config_full` is missing, the backend wasn't restarted: `systemctl restart aether-backend`

**Q: OpenClaw URL doesn't work?**
- The URL uses `http://localhost:<port>` — this only works when accessing from the same machine
- For remote access, replace `localhost` with the server's IP address
- The `?token=` parameter authenticates the gateway connection

---

## 3. Master Node Persistence + Revoke

### 3.1 Problem Statement

When a container is selected as master from the Master Node page, it should persist as the master throughout the session. The Orchestrate page should automatically use it. A "Revoke" button should allow removing the master designation.

### 3.2 Architecture

```
Master Node Page (RemoteConfig.tsx)
    ↓ POST /api/deploy/set-master
Backend (deploy.py) — stores in-memory _master_deployment_id
    ↑ GET /api/deploy/master
Orchestrate Page (OrchestratePanel.tsx) — auto-selects master
```

The master deployment ID is stored **in-memory** on the backend (survives across requests, resets on server restart). It's initialized from `MASTER_DEPLOYMENT_ID` in `.env` if set.

### 3.3 Backend Changes

#### `api/routers/deploy.py` — 3 new items

**In-memory state:**
```python
_master_deployment_id: str = settings.MASTER_DEPLOYMENT_ID or ""
```

**GET /api/deploy/master — Get current master**
```python
@router.get("/master")
async def get_master_deployment():
    global _master_deployment_id
    if _master_deployment_id:
        try:
            info = deployer.get_info(_master_deployment_id)
            return {
                "master_deployment_id": _master_deployment_id,
                "name": info.get("name", ""),
                "port": info.get("port"),
                "status": info.get("status"),
            }
        except ValueError:
            _master_deployment_id = ""  # Auto-clear if deployment no longer exists
    return {"master_deployment_id": "", "name": "", "port": None, "status": None}
```

**POST /api/deploy/set-master — Set or revoke master**
```python
@router.post("/set-master")
async def set_master_deployment(req: SetMasterRequest):
    global _master_deployment_id
    if req.deployment_id:
        info = deployer.get_info(req.deployment_id)  # Validates it exists
        _master_deployment_id = req.deployment_id
        return {"ok": True, "master_deployment_id": req.deployment_id, "name": info.get("name", ""), ...}
    else:
        _master_deployment_id = ""  # Revoke
        return {"ok": True, "master_deployment_id": "", "message": "Master node revoked"}
```

### 3.4 Frontend Changes

#### `ui/src/api.ts` — New types and functions
```typescript
export interface MasterDeployment {
    master_deployment_id: string;
    name: string;
    port: number | null;
    status: string | null;
}

export const fetchMasterDeployment = async (): Promise<MasterDeployment> => { ... };
export const setMasterDeployment = async (deploymentId: string): Promise<{ ok: boolean; message: string }> => { ... };
```

#### `ui/src/components/RemoteConfig.tsx` — Master Node Designation section

Added a new collapsible section at the top of the Master Node page:

**When no master is set:**
- Shows a dropdown of running containers
- "Set as Master Node" button

**When master is set:**
- Shows the current master with green badge "Active Master"
- "Revoke Master Node" button (red, danger style)

**State variables added:**
```typescript
const [deployments, setDeployments] = useState<DeploymentInfo[]>([])
const [masterDeployId, setMasterDeployId] = useState('')
const [masterName, setMasterName] = useState('')
const [selectedMasterId, setSelectedMasterId] = useState('')
const [settingMaster, setSettingMaster] = useState(false)
```

#### `ui/src/components/OrchestratePanel.tsx` — Auto-select master

```typescript
const loadData = async () => {
    const [taskList, templateList, deployList, masterInfo] = await Promise.all([
        fetchOrchestratorTasks(),
        fetchAgentTemplates(),
        fetchDeployList(),
        fetchMasterDeployment().catch(() => ({ master_deployment_id: '' })),
    ])
    // Auto-select: prefer the designated master, then first running
    if (masterInfo.master_deployment_id && running.some(d => d.deployment_id === masterInfo.master_deployment_id)) {
        setSelectedDeployment(masterInfo.master_deployment_id)
    } else if (running.length > 0 && !selectedDeployment) {
        setSelectedDeployment(running[0].deployment_id)
    }
}
```

### 3.5 Testing

```bash
# Test set master
curl -s -X POST http://localhost:8000/api/deploy/set-master \
  -H 'Content-Type: application/json' \
  -d '{"deployment_id":"openclaw-t2wn"}'
# Output: {"ok":true,"master_deployment_id":"openclaw-t2wn","name":"Jason Master","message":"Master node set to Jason Master"}

# Test get master
curl -s http://localhost:8000/api/deploy/master
# Output: {"master_deployment_id":"openclaw-t2wn","name":"Jason Master","port":61816,"status":"running"}

# Test revoke
curl -s -X POST http://localhost:8000/api/deploy/set-master \
  -H 'Content-Type: application/json' \
  -d '{"deployment_id":""}'
# Output: {"ok":true,"master_deployment_id":"","name":"","message":"Master node revoked"}
```

---

## 4. Orchestrate — Expert Agents & Mission Board

### 4.1 Investigation Findings

**Q: Are expert agents (Python Backend Expert, React Frontend Expert, etc.) separate containers?**

**A: NO.** Expert agents are **LLM prompt templates** defined in `api/services/agent_templates.py`. They are NOT separate containers. Here's how it works:

1. User submits a task on the Orchestrate page
2. The orchestrator uses the **Jason model** (LLM) to decompose the task into subtasks
3. Each subtask is assigned an `agent_type` (e.g., `python-backend`, `react-frontend`)
4. For execution, the orchestrator:
   - **Primary:** Sends the subtask to the **same master container** via WebSocket, with an expert-prefixed prompt
   - **Fallback:** Uses the LLM client directly with the expert's system prompt
5. Jason reviews each subtask output and approves or requests changes
6. After all subtasks complete, Jason synthesizes the final result

**Key code paths:**
- `_execute_via_container()` — sends to master container with expert prefix
- `_execute_via_llm()` — direct LLM call with expert system prompt (fallback)
- Both use the **same master deployment** — no new containers are spawned

**6 Expert Agent Templates:**
| Type | Name | Tags |
|------|------|------|
| `python-backend` | Python Backend Expert | python, fastapi, django, flask, backend, api, sqlalchemy |
| `react-frontend` | React Frontend Expert | react, typescript, tailwind, nextjs, frontend, css, vite |
| `database-expert` | Database Expert | sql, postgresql, mongodb, redis, database, schema, migration |
| `devops-expert` | DevOps Expert | docker, kubernetes, cicd, terraform, aws, linux, deployment |
| `fullstack` | Full-Stack Developer | fullstack, react, python, node, api, general |
| `testing-expert` | Testing & QA Expert | testing, pytest, jest, playwright, tdd, qa |

### 4.2 Mission Board Integration — Bug Found & Fixed

**Bug:** The Orchestrate page had no way to link tasks to Mission Board cards. The backend `orchestrator.submit_task()` supports `mission_id` for auto-updating mission status, but:
1. The API endpoint `POST /api/orchestrate/task` did NOT accept `mission_id`
2. The frontend `submitOrchestratorTask()` did NOT pass `mission_id`
3. The OrchestratePanel UI had no mission selector

**Fix — 3 changes:**

#### `api/routers/orchestrate.py` — Accept mission_id
```python
class SubmitTaskRequest(BaseModel):
    description: str
    master_deployment_id: str
    mission_id: Optional[str] = None  # NEW: Link to Mission Board card

# In the endpoint:
task = await orchestrator.submit_task(
    description=req.description,
    master_deployment_id=req.master_deployment_id,
    mission_id=req.mission_id,  # NEW: pass through
)
```

#### `ui/src/api.ts` — Pass mission_id
```typescript
export const submitOrchestratorTask = async (
    description: string,
    masterDeploymentId: string,
    missionId?: string  // NEW parameter
): Promise<OrchestratorTask> => {
    const response = await api.post('/orchestrate/task', {
        description,
        master_deployment_id: masterDeploymentId,
        mission_id: missionId || undefined,  // NEW
    });
    return response.data;
};
```

#### `ui/src/components/OrchestratePanel.tsx` — Mission selector dropdown

Added:
- `import { useMissions } from '../context/MissionContext'`
- `const [selectedMission, setSelectedMission] = useState('')`
- `const { missions } = useMissions()`
- Mission selector dropdown in the UI (below Master Container selector)
- Passes `selectedMission` to `submitOrchestratorTask()`

**How it works now:**
1. User creates a mission on the Mission Board (e.g., "Build user auth system")
2. On the Orchestrate page, user selects that mission from the "Link to Mission" dropdown
3. When the task is submitted, the orchestrator:
   - Posts progress updates to Team Chat under that mission
   - Broadcasts `mission:updated` WebSocket events
   - Auto-moves the mission card to "Active" when execution starts
   - Auto-moves to "Completed" when synthesis finishes
   - Auto-moves to "Failed" if the task fails

### 4.3 Mission Board Card Movement

**Q: Does Mission Board card movement work?**

**A: YES** — the Mission Board (Dashboard.tsx) uses `@dnd-kit/core` for drag-and-drop. Cards can be manually dragged between columns (Queue → Active → Completed → Failed). The `editMission()` function calls `PUT /api/missions/{id}` to update the status.

**With the orchestration fix**, cards also move **automatically** when linked to an orchestration task:
- Task starts → mission moves to "Active"
- Task completes → mission moves to "Completed"
- Task fails → mission moves to "Failed"

This is handled by `ws_manager.broadcast_all("mission:updated", {...})` in the orchestrator, and the `MissionContext` polls every 5 seconds for updates.

---

## Summary of All Changes

### Files Modified

| File | Changes |
|------|---------|
| `ui/src/components/onboarding/OnboardingFlow.tsx` | Added `useEffect`, `fetchAuthConfig` import; `googleRequired`/`isGoogleAuthed` state; blocks Dashboard shortcut when auth required |
| `api/routers/deploy.py` | Return `env_config_full` from info endpoint; added `GET /master`, `POST /set-master` endpoints with in-memory state |
| `ui/src/api.ts` | Added `env_config_full` to `DeployDetailInfo`; added `MasterDeployment` interface + `fetchMasterDeployment`/`setMasterDeployment`; updated `submitOrchestratorTask` with optional `missionId` |
| `ui/src/components/Agents.tsx` | Use `env_config_full` for display/editing; added OpenClaw UI link; 4-column grid for connection info |
| `ui/src/components/RemoteConfig.tsx` | Added Master Node Designation section with set/revoke UI; imports for deploy APIs |
| `ui/src/components/OrchestratePanel.tsx` | Auto-select master deployment; added mission selector dropdown; passes `mission_id` to backend |
| `api/routers/orchestrate.py` | Added `mission_id` to `SubmitTaskRequest`; passes to `orchestrator.submit_task()` |

### New API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/deploy/master` | Get currently designated master deployment |
| POST | `/api/deploy/set-master` | Set or revoke master deployment |

### Debugging Quick Reference

| Issue | Check |
|-------|-------|
| Google auth not working | Verify `GOOGLE_CLIENT_ID` in both `api/.env` and `ui/.env` |
| Env values still masked | Restart backend, check `env_config_full` in API response |
| Master not persisting | Master is in-memory; check `GET /api/deploy/master` |
| Mission not auto-updating | Ensure mission is selected in Orchestrate dropdown before submitting |
| Expert agents not spawning | They don't spawn — they're LLM prompt templates, not containers |
