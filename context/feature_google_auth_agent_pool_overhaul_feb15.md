# Feature: Google Auth + Agent Pool Overhaul — Session Feb 15, 2026

> Comprehensive documentation of all changes, commands, outputs, reasoning, and code changes for two features:
> 1. Google Auth with email allowlist (feature-flagged)
> 2. Agent Pool page overhaul (expandable cards, refresh, remove, restart, update)

---

## Session Overview

**Date:** Feb 15, 2026
**Objective:** Add Google OAuth authentication with email allowlist under a feature flag, and overhaul the Agents Pool page to support container management (refresh, remove, restart, expand for details, inline config editing).

---

## Feature 1: Google Auth with Email Allowlist

### 1.1 Design & Reasoning

**Problem:** The site needs authentication restricted to a specific Google account (`bhavith.patnam@oneconvergence.com`). This must be feature-flagged so it can be toggled without code changes.

**Architecture:**
- Two new config flags in `api/config.py`:
  - `AUTH_REQUIRE_GOOGLE` (bool) — when `true`, username/password login is disabled
  - `GOOGLE_ALLOWED_EMAILS` (string) — comma-separated list of allowed Google emails
- Backend enforcement in `api/routers/auth.py`:
  - `/api/auth/login` returns 403 when `AUTH_REQUIRE_GOOGLE=true`
  - `/api/auth/google` checks email against allowlist before creating/returning JWT
  - New `/api/auth/config` endpoint returns auth mode flags to frontend
- Frontend already has Google OAuth support via `@react-oauth/google` — no frontend changes needed for the auth flow itself
- The `fetchAuthConfig` API function was added to `ui/src/api.ts` for future frontend use

**Why feature-flagged:** The Google OAuth requires a valid `GOOGLE_CLIENT_ID` from Google Cloud Console. When not configured, the system falls back to username/password login. The `AUTH_REQUIRE_GOOGLE` flag adds an additional layer — even if Google is configured, legacy login still works unless the flag is set to `true`.

### 1.2 Files Modified

#### `api/config.py` — Added 2 new settings
```python
# Lines 44-45 (new)
AUTH_REQUIRE_GOOGLE: bool = False  # When True, only Google OAuth login is allowed
GOOGLE_ALLOWED_EMAILS: str = ""   # Comma-separated allowlist. Empty = allow all
```

**Reasoning:** Using `pydantic_settings.BaseSettings` means these are automatically read from `.env` file or environment variables. No migration needed.

#### `api/routers/auth.py` — 3 changes

**Change 1: Block login when Google auth required (line 62-64)**
```python
@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    # Block username/password login when Google auth is required
    if settings.AUTH_REQUIRE_GOOGLE:
        raise HTTPException(status_code=403, detail="Username/password login is disabled. Please use Google Sign-In.")
    # ... rest of login logic unchanged
```

**Reasoning:** Returns 403 (Forbidden) not 401 (Unauthorized) because the credentials may be valid — the *method* is disabled.

**Change 2: Email allowlist enforcement in Google auth (line 154-160)**
```python
    # Enforce email allowlist if configured
    allowed_raw = settings.GOOGLE_ALLOWED_EMAILS
    if allowed_raw:
        allowed_emails = [e.strip().lower() for e in allowed_raw.split(",") if e.strip()]
        if allowed_emails and email.lower() not in allowed_emails:
            logger.warning(f"Google auth denied for {email} — not in allowlist")
            raise HTTPException(status_code=403, detail=f"Access denied. Email {email} is not authorized.")
```

**Reasoning:** Case-insensitive comparison. Only enforced when `GOOGLE_ALLOWED_EMAILS` is non-empty. Empty = allow all Google accounts.

**Change 3: New `/api/auth/config` endpoint (line 206-213)**
```python
@router.get("/config")
async def get_auth_config():
    """Return auth configuration flags so the frontend knows which login modes are available."""
    return {
        "google_enabled": bool(settings.GOOGLE_CLIENT_ID),
        "google_required": settings.AUTH_REQUIRE_GOOGLE,
        "legacy_login_enabled": not settings.AUTH_REQUIRE_GOOGLE,
    }
```

**Reasoning:** Frontend can call this to dynamically show/hide login options. No auth required for this endpoint (it's config, not data).

#### `api/.env` — Added 2 new variables
```env
AUTH_REQUIRE_GOOGLE=false
GOOGLE_ALLOWED_EMAILS=bhavith.patnam@oneconvergence.com
```

**Note:** `AUTH_REQUIRE_GOOGLE` is set to `false` by default. To enable Google-only auth:
1. Set `GOOGLE_CLIENT_ID` to your Google Cloud Console OAuth client ID
2. Set `VITE_GOOGLE_CLIENT_ID` in `ui/.env` to the same value
3. Set `AUTH_REQUIRE_GOOGLE=true` in `api/.env`
4. Restart backend: `systemctl restart aether-backend`

#### `ui/src/api.ts` — Added AuthConfig interface and fetchAuthConfig function
```typescript
export interface AuthConfig {
    google_enabled: boolean;
    google_required: boolean;
    legacy_login_enabled: boolean;
}

export const fetchAuthConfig = async (): Promise<AuthConfig> => {
    const response = await api.get('/auth/config');
    return response.data;
};
```

### 1.3 Testing

#### Test 1: Auth config endpoint (AUTH_REQUIRE_GOOGLE=false)
```bash
curl -s https://agent.virtualgpt.org/api/auth/config
```
**Output:**
```json
{"google_enabled": false, "google_required": false, "legacy_login_enabled": true}
```
✅ Correct — Google not configured, legacy login enabled.

#### Test 2: Login still works when flag is off
```bash
curl -s -X POST https://agent.virtualgpt.org/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Oc123"}'
```
**Output:** `{"access_token":"eyJhbG...","token_type":"bearer","user":{...}}`
✅ Login works.

#### Test 3: Login blocked when AUTH_REQUIRE_GOOGLE=true
```bash
# Temporarily set AUTH_REQUIRE_GOOGLE=true in .env and restart
sed -i 's/AUTH_REQUIRE_GOOGLE=false/AUTH_REQUIRE_GOOGLE=true/' api/.env
systemctl restart aether-backend

curl -s -X POST https://agent.virtualgpt.org/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Oc123"}'
```
**Output:** `{"detail":"Username/password login is disabled. Please use Google Sign-In."}`
✅ Login blocked with 403.

#### Test 4: Auth config with flag on
```bash
curl -s https://agent.virtualgpt.org/api/auth/config
```
**Output:** `{"google_enabled":false,"google_required":true,"legacy_login_enabled":false}`
✅ Correct flags.

**Reverted:** `AUTH_REQUIRE_GOOGLE=false` after testing.

### 1.4 How to Enable Google Auth (Step-by-Step)

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Create an OAuth 2.0 Client ID (Web application type)
3. Add authorized JavaScript origins: `https://agent.virtualgpt.org`
4. Add authorized redirect URIs: `https://agent.virtualgpt.org`
5. Copy the Client ID
6. Set in `api/.env`:
   ```env
   GOOGLE_CLIENT_ID=your-client-id-here
   AUTH_REQUIRE_GOOGLE=true
   GOOGLE_ALLOWED_EMAILS=bhavith.patnam@oneconvergence.com
   ```
7. Set in `ui/.env`:
   ```env
   VITE_GOOGLE_CLIENT_ID=your-client-id-here
   ```
8. Restart both services:
   ```bash
   systemctl restart aether-backend
   systemctl restart aether-frontend
   ```

---

## Feature 2: Agent Pool Overhaul

### 2.1 Design & Reasoning

**Problem:** The Agents Pool page showed deployment cards as static, non-interactive elements. Users needed the ability to:
- Refresh all containers/agents
- Click a card to see detailed container configuration
- Restart individual containers
- Remove deployments entirely
- Edit container .env configuration and apply changes

**Architecture:**
- **Backend:** 4 new endpoints in `api/routers/deploy.py` + 4 new methods in `api/services/deployer.py`
- **Frontend:** Complete overhaul of `ui/src/components/Agents.tsx` with expandable cards
- **API Client:** 4 new functions + 1 new interface in `ui/src/api.ts`

### 2.2 Backend Changes

#### `api/services/deployer.py` — 4 new methods on the Deployer class

**Method 1: `get_info(deployment_id)` (line 674-711)**
```python
def get_info(self, deployment_id: str) -> dict:
    """Get detailed info about a deployment including its .env config (sensitive values masked)."""
```
- Reads the deployment's `.env` file and parses all KEY=VALUE pairs
- Masks sensitive values (API keys, tokens) for display: `sk-or-v1...5d83`
- Returns both `env_config` (masked) and `env_config_raw` (full values, stripped before API response)

**Reasoning:** The frontend needs to display config but shouldn't show full API keys by default. The masking logic uses first 8 + last 4 chars for keys longer than 12 chars.

**Method 2: `restart(deployment_id)` (line 713-739)**
```python
async def restart(self, deployment_id: str) -> dict:
    """Restart a deployment container (docker compose restart)."""
```
- Uses `docker compose up -d --force-recreate` (not just `restart`) to pick up .env changes
- Updates in-memory status tracking

**Reasoning:** `--force-recreate` ensures the container is rebuilt with any new environment variables, unlike `docker compose restart` which only restarts the existing container.

**Method 3: `remove(deployment_id)` (line 741-764)**
```python
async def remove(self, deployment_id: str) -> dict:
    """Remove a deployment entirely — stops container and deletes deployment directory."""
```
- Stops container via `docker compose down`
- Deletes the entire `deployments/<id>/` directory
- Removes from in-memory tracking

**Reasoning:** Full cleanup. Uses `shutil.rmtree` for directory removal. Wrapped in try/except so removal succeeds even if stop fails.

**Method 4: `update_env(deployment_id, updates)` (line 766-817)**
```python
def update_env(self, deployment_id: str, updates: dict[str, str]) -> dict:
    """Update specific keys in a deployment's .env file."""
```
- Reads existing .env line by line
- Replaces matching KEY=VALUE lines
- Appends new keys that don't exist yet
- Updates in-memory tracking for PORT, DEPLOY_NAME, OPENCLAW_GATEWAY_TOKEN

**Reasoning:** Preserves comments and formatting in the .env file. Only modifies the specific keys requested.

#### `api/routers/deploy.py` — 4 new endpoints

**Endpoint 1: `GET /api/deploy/info/{deployment_id}`**
```python
@router.get("/info/{deployment_id}")
async def get_deployment_info(deployment_id: str):
```
Returns: `{deployment_id, name, port, gateway_token, status, deploy_dir, env_config}`

**Endpoint 2: `POST /api/deploy/restart`**
```python
@router.post("/restart")
async def restart_deployment(req: DeployActionRequest):
```
Returns: `{ok, deployment_id, port, status, message}`

**Endpoint 3: `DELETE /api/deploy/remove/{deployment_id}`**
```python
@router.delete("/remove/{deployment_id}")
async def remove_deployment(deployment_id: str):
```
Returns: `{ok, deployment_id, status, message}`

**Endpoint 4: `PUT /api/deploy/update-env`**
```python
@router.put("/update-env")
async def update_deployment_env(req: DeployUpdateEnvRequest):
```
Request body: `{deployment_id, updates: {KEY: VALUE, ...}}`
Returns: `{ok, deployment_id, updated_keys, message}`

**New request model:**
```python
class DeployUpdateEnvRequest(BaseModel):
    deployment_id: str
    updates: dict  # KEY=VALUE pairs to set/update
```

### 2.3 Frontend Changes

#### `ui/src/api.ts` — New types and functions

```typescript
export interface DeployDetailInfo {
    deployment_id: string;
    name: string;
    port: number;
    gateway_token: string;
    status: string;
    deploy_dir: string;
    env_config: Record<string, string>;
}

export const fetchDeployInfo = async (deploymentId: string): Promise<DeployDetailInfo> => { ... };
export const restartDeploy = async (deploymentId: string): Promise<{ ok: boolean; message: string }> => { ... };
export const removeDeploy = async (deploymentId: string): Promise<{ ok: boolean; message: string }> => { ... };
export const updateDeployEnv = async (deploymentId: string, updates: Record<string, string>): Promise<{ ok: boolean; message: string }> => { ... };
```

#### `ui/src/components/Agents.tsx` — Complete overhaul

**New imports added:**
- `AnimatePresence` from framer-motion (for expand/collapse animations)
- `ChevronDown, ChevronRight, RotateCw, Save, X, Pencil, Eye, EyeOff` from lucide-react
- `fetchDeployInfo, restartDeploy, removeDeploy, updateDeployEnv, DeployDetailInfo` from api

**New state variables:**
| State | Type | Purpose |
|-------|------|---------|
| `refreshing` | boolean | Shows spinner on "Refresh All" button |
| `expandedDeploy` | string \| null | Currently expanded deployment card ID |
| `deployDetail` | DeployDetailInfo \| null | Detailed info for expanded card |
| `detailLoading` | boolean | Loading state for detail fetch |
| `actionLoading` | Record<string, string> | Per-deployment action state (restarting/removing/saving) |
| `actionMessage` | object \| null | Toast message for action results |
| `editingEnv` | boolean | Whether env editing mode is active |
| `envEdits` | Record<string, string> | Current env edit values |
| `showSensitive` | Record<string, boolean> | Per-key toggle for showing/hiding sensitive values |

**New handler functions:**
| Function | Purpose |
|----------|---------|
| `refreshAll()` | Refreshes agents, deployments, and remote status simultaneously |
| `toggleExpand(deployId)` | Expands/collapses a card, fetches detail info on expand |
| `handleRestart(deployId)` | Restarts a container, shows success/error toast |
| `handleRemove(deployId, name)` | Confirms and removes a deployment |
| `startEditEnv()` | Enters env editing mode with current values |
| `cancelEditEnv()` | Exits env editing mode |
| `saveEnvAndRestart()` | Saves changed env keys and restarts container |

**UI Changes:**
1. **Clickable cards** — Each deployment card is now a button that expands on click
2. **Chevron indicator** — Shows `>` when collapsed, `v` when expanded
3. **Summary row** — Collapsed cards show port and connection info
4. **Expanded panel** — Shows:
   - Action buttons: Restart, Remove, Edit Config
   - Connection info grid: Port, WebSocket URL, Deployment ID
   - Environment Configuration table with all .env key-value pairs
   - Sensitive values masked by default with eye toggle
5. **Edit mode** — Click "Edit Config" to enter inline editing:
   - All values become editable input fields
   - Sensitive fields use password input type (toggleable)
   - "Save & Restart" button saves changes and restarts container
   - "Cancel" button discards changes
6. **Toast notifications** — Success/error messages for all actions
7. **Refresh All** — Button with spinning animation during refresh
8. **Show All** — Now includes stopped deployment count in button label
9. **Full-width expansion** — Expanded card spans all 3 grid columns

### 2.4 Testing

#### Test 1: Deploy info endpoint
```bash
curl -s https://agent.virtualgpt.org/api/deploy/info/openclaw-t2wn | python3 -m json.tool
```
**Output:**
```json
{
    "deployment_id": "openclaw-t2wn",
    "name": "Jason Master",
    "port": 61816,
    "status": "running",
    "env_config": {
        "PORT": "61816",
        "OPENCLAW_GATEWAY_TOKEN": "3vMRPCr2...L3U8",
        "DEPLOY_NAME": "Jason Master",
        "OPENROUTER_API_KEY": "sk-or-v1...5d83",
        ...
    }
}
```
✅ Sensitive values masked correctly.

#### Test 2: Update env endpoint
```bash
curl -s -X PUT https://agent.virtualgpt.org/api/deploy/update-env \
  -H "Content-Type: application/json" \
  -d '{"deployment_id":"46bb451534","updates":{"DEPLOY_NAME":"Sapphire Helix Test"}}'
```
**Output:** `{"ok": true, "updated_keys": ["DEPLOY_NAME"], "message": "Environment updated..."}`
✅ Env update works. (Reverted after test.)

#### Test 3: Deploy list (14 deployments, 11 running)
```bash
curl -s https://agent.virtualgpt.org/api/deploy/list | python3 -c "..."
```
**Output:** `14 deployments, 11 running`
✅ All deployments tracked.

#### Test 4: Frontend compilation
```bash
journalctl -u aether-frontend -n 5
```
**Output:** `8:18:49 PM [vite] hmr update /src/components/Agents.tsx, /src/index.css`
✅ No compilation errors. HMR picked up changes.

---

## Summary of All Changes

### Files Modified

| File | Change | Lines |
|------|--------|-------|
| `api/config.py` | Added `AUTH_REQUIRE_GOOGLE`, `GOOGLE_ALLOWED_EMAILS` settings | 44-45 |
| `api/routers/auth.py` | Block login when flag on; email allowlist; `/api/auth/config` endpoint | 62-64, 154-160, 206-213 |
| `api/routers/deploy.py` | Added `DeployUpdateEnvRequest` model; 4 new endpoints (info, restart, remove, update-env) | 56-59, 187-256 |
| `api/services/deployer.py` | Added `get_info`, `restart`, `remove`, `update_env` methods | 674-817 |
| `api/.env` | Added `AUTH_REQUIRE_GOOGLE=false`, `GOOGLE_ALLOWED_EMAILS=bhavith.patnam@oneconvergence.com` | (gitignored) |
| `ui/src/api.ts` | Added `AuthConfig`, `DeployDetailInfo` interfaces; `fetchAuthConfig`, `fetchDeployInfo`, `restartDeploy`, `removeDeploy`, `updateDeployEnv` functions | 98-109, 432-460 |
| `ui/src/components/Agents.tsx` | Complete overhaul — expandable cards, refresh, remove, restart, inline env editing | 1-541 (full rewrite) |

### New API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/auth/config` | Auth mode flags for frontend |
| GET | `/api/deploy/info/{id}` | Detailed deployment info with masked .env config |
| POST | `/api/deploy/restart` | Restart a container (force-recreate) |
| DELETE | `/api/deploy/remove/{id}` | Remove deployment (stop + delete files) |
| PUT | `/api/deploy/update-env` | Update specific .env keys |

### Feature Flags

| Flag | Default | Purpose |
|------|---------|---------|
| `AUTH_REQUIRE_GOOGLE` | `false` | When `true`, disables username/password login |
| `GOOGLE_ALLOWED_EMAILS` | `bhavith.patnam@oneconvergence.com` | Comma-separated email allowlist (empty = allow all) |
| `GOOGLE_CLIENT_ID` | `""` | Google OAuth client ID (empty = Google auth disabled) |

### Debugging Guide for New Developers

#### Google Auth not working?
1. Check `GOOGLE_CLIENT_ID` is set in both `api/.env` and `ui/.env` (`VITE_GOOGLE_CLIENT_ID`)
2. Check Google Cloud Console authorized origins include your domain
3. Check `api/auth/config` endpoint to see current flags
4. Check backend logs: `journalctl -u aether-backend -f`

#### Agent Pool card not expanding?
1. Check browser console for errors
2. Verify `/api/deploy/info/{id}` returns data: `curl https://agent.virtualgpt.org/api/deploy/info/<id>`
3. Check the deployment has a valid `.env` file in `deployments/<id>/`

#### Container restart failing?
1. Check Docker is running: `docker ps`
2. Check deployment directory exists: `ls deployments/<id>/`
3. Check docker-compose.yml exists in deployment dir
4. Check backend logs for compose errors

#### Env update not taking effect?
1. Updates require a container restart to take effect
2. The "Save & Restart" button does both automatically
3. Verify .env was updated: `cat deployments/<id>/.env`
