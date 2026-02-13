# Feature: Secure Agent Deployer UI — Onboarding Flow

## Overview

Replaced the default login page with a full onboarding flow for deploying OpenClaw agents. The flow includes animated visuals, optional Google OAuth authentication, a simulated installation progress view, a configuration form for bot settings, a **real-time deployment progress view with live container logs**, and a completion screen that redirects to the Chat page connected to the newly deployed container.

The legacy username/password login is preserved behind a feature flag (`VITE_LEGACY_LOGIN=true`).

---

## Chat Session Summary

### Issues & Resolutions

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| Blank page after adding `GoogleOAuthProvider` | Provider crashes when `clientId` is empty string | Made `GoogleOAuthProvider` conditional in `App.tsx` — only wraps when `GOOGLE_CLIENT_ID` is set |
| `useGoogleLogin` hook crashes without provider context | Hook imported at module level in `OnboardingFlow.tsx` | Extracted `GoogleAuthButton` into separate file, lazy-loaded with `React.lazy()` so `@react-oauth/google` is never imported when no provider exists |
| Backend Google auth only handled `id_token` | `useGoogleLogin` implicit flow returns `access_token`, not `id_token` | Updated `/api/auth/google` to try `id_token` verification first, then fall back to Google userinfo API with `access_token` via `httpx` |
| Database missing new columns for Google OAuth users | SQLAlchemy `create_all` doesn't alter existing tables | Ran manual `ALTER TABLE` migration to add `email`, `google_id`, `avatar_url` columns |
| `import.meta.env` TypeScript lint error | Vite's `ImportMeta` type extension not picked up by IDE | False positive — works at runtime, build succeeds. Ignored. |

### Feature Requests Implemented

1. **Onboarding flow** — Split-screen layout with animated visuals (left) and step-by-step flow (right)
2. **Google OAuth** — Optional authentication via Google (skipped when `VITE_GOOGLE_CLIENT_ID` is empty)
3. **Installation progress** — Simulated system provisioning animation with timeline and terminal logs
4. **Configuration form** — LLM provider selection (OpenRouter/OpenAI/Anthropic), API key, optional Telegram bot
5. **Deployment progress** — Real-time container deployment with live docker logs polling
6. **Auto-redirect to Chat** — On deployment completion, redirects to Chat page and auto-connects to the deployed container session
7. **Legacy login flag** — `VITE_LEGACY_LOGIN=true` shows the old username/password login

---

## Files Changed

### Backend

| File | Change |
|------|--------|
| `api/config.py` | Added `GOOGLE_CLIENT_ID` setting |
| `api/models/user.py` | Added `email`, `google_id`, `avatar_url` fields; made `password_hash` nullable |
| `api/schemas/auth.py` | Added `GoogleAuthRequest` schema; extended `UserResponse` with `email`, `avatar_url` |
| `api/routers/auth.py` | Added `POST /api/auth/google` endpoint — verifies both `id_token` and `access_token` flows, auto-creates users, issues JWT. Added `httpx` import for Google userinfo API. |
| `api/.env` | Added `GOOGLE_CLIENT_ID=` placeholder |

### Frontend — New Files

| File | Purpose |
|------|---------|
| `ui/src/components/onboarding/Visuals.tsx` | Animated left-panel background with concentric circles and scan line |
| `ui/src/components/onboarding/InstallationView.tsx` | Simulated installation progress with timeline steps and terminal log output |
| `ui/src/components/onboarding/ConfigForm.tsx` | Configuration form: LLM provider, API key, optional Telegram bot token/user ID |
| `ui/src/components/onboarding/GoogleAuthButton.tsx` | Isolated Google auth button using `useGoogleLogin` hook (lazy-loaded) |
| `ui/src/components/onboarding/OnboardingFlow.tsx` | Main orchestrator: phases AUTH → INSTALLING → CONFIGURATION → DEPLOYING → COMPLETE |
| `ui/src/components/onboarding/DeploymentProgress.tsx` | Real-time deployment progress: polls `/deploy/logs` and `/deploy/status`, shows timeline + live container logs |
| `ui/.env` | `VITE_GOOGLE_CLIENT_ID=`, `VITE_LEGACY_LOGIN=false` |

### Frontend — Modified Files

| File | Change |
|------|--------|
| `ui/src/index.css` | Added `brand-*` and `dark-*` color tokens, custom animations (`pulse-slow`, `float`, `scan`) in `@theme` block |
| `ui/src/api.ts` | Added `googleLogin()` function that sends access token to `/api/auth/google` and stores JWT |
| `ui/src/App.tsx` | Added `GoogleOAuthProvider` (conditional), `VITE_LEGACY_LOGIN` flag check, `OnboardingFlow` route, `pendingDeploymentId` state for auto-redirect to Chat |
| `ui/src/components/Chat.tsx` | Added auto-connect logic: reads `aether_pending_deploy` from localStorage, auto-selects and connects to the deployed container |
| `ui/src/main.tsx` | No permanent changes (debug ErrorBoundary was added then removed) |
| `ui/index.html` | No permanent changes (debug error handlers were added then removed) |

### Packages Installed

| Package | Location | Purpose |
|---------|----------|---------|
| `google-auth`, `google-auth-oauthlib` | Backend (pip) | Google ID token verification |
| `httpx` | Backend (pip) | Google userinfo API calls for access_token flow |
| `@react-oauth/google` | Frontend (npm) | Google OAuth login button and hooks |

---

## Architecture

### Onboarding Flow Phases

```
AUTH → INSTALLING → CONFIGURATION → DEPLOYING → COMPLETE
 │         │              │              │           │
 │         │              │              │           └─ Success overlay, "Open Chat Session" button
 │         │              │              └─ DeploymentProgress: real docker logs polling
 │         │              └─ ConfigForm: LLM provider + API key + Telegram
 │         └─ InstallationView: simulated progress animation
 └─ GoogleAuthButton (lazy-loaded, skipped if no GOOGLE_CLIENT_ID)
```

### Auto-Redirect Flow

```
OnboardingFlow COMPLETE
  → user clicks "Open Chat Session"
  → onComplete(deploymentId) called
  → App.tsx stores pendingDeploymentId
  → setIsAuthenticated(true) renders dashboard
  → useEffect detects pendingDeploymentId
  → setActiveTab('hub') + localStorage.setItem('aether_pending_deploy', id)
  → Chat component mounts
  → useEffect reads aether_pending_deploy
  → auto-selects deployment + calls connectDeployChat()
  → user sees Chat connected to their new container
```

### DeploymentProgress — 2-Phase Polling

**Phase 1: Container Deployment** (every 2s, 3-min timeout)
```
Steps: Configure → Pull Image → Start Container
  1. GET /api/deploy/logs/{id}?tail=100 → display in terminal view
  2. GET /api/deploy/status/{id} → infer step from container status
  3. Minimum display time per step (1.5–2.5s) for smooth progress even on fast deploys
  4. If status === 'running' → transition to Phase 2
  5. If error detected in logs → onError(msg)
```

**Phase 2: Gateway Health** (every 4s, 3-min timeout)
```
Steps: Authenticating Gateway → Verifying Chat Session
  1. GET /api/deploy/gateway-health/{id}
     Backend probes:
       a. HTTP GET http://localhost:<port>/?token=<gateway_token> (authenticates gateway)
       b. WebSocket handshake ws://localhost:<port> with token (verifies chat readiness)
  2. If healthy (http_ok && ws_ok) → mark all steps done → onComplete
  3. If timeout → onError with manual config suggestion
```

### Google OAuth Flow

```
Frontend (useGoogleLogin implicit flow)
  → Google popup → access_token returned
  → POST /api/auth/google { credential: access_token }

Backend:
  1. Try verify_oauth2_token (id_token path) → fails for access_token
  2. Fall back to GET googleapis.com/oauth2/v3/userinfo with Bearer token
  3. Extract sub, email, name, picture
  4. Find/create user by google_id or email
  5. Issue JWT → return TokenResponse
```

---

## Environment Variables

### Backend (`api/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_CLIENT_ID` | No | Google OAuth Client ID from Google Cloud Console. If empty, Google auth is disabled. |

### Frontend (`ui/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_GOOGLE_CLIENT_ID` | `""` | Google OAuth Client ID. If empty, AUTH phase is skipped in onboarding. |
| `VITE_LEGACY_LOGIN` | `"false"` | Set to `"true"` to show the old username/password login instead of onboarding. |

---

## Commands Used

```bash
# Backend packages
source api/venv/bin/activate
pip install google-auth google-auth-oauthlib httpx

# Frontend packages
cd ui && npm install @react-oauth/google

# Database migration (manual ALTER TABLE for existing SQLite)
python3 -c "
import sqlite3
conn = sqlite3.connect('api/aether.db')
cursor = conn.cursor()
for col, typ in [('email', 'TEXT'), ('google_id', 'TEXT'), ('avatar_url', 'TEXT')]:
    cursor.execute(f'ALTER TABLE users ADD COLUMN {col} {typ}')
conn.commit()
conn.close()
"

# Verify build
cd ui && npx vite build

# Start backend
cd api && python3 main.py

# Start frontend
cd ui && npx vite
```

---

## Testing Checklist

- [ ] With `VITE_LEGACY_LOGIN=true`: old login page renders
- [ ] With `VITE_LEGACY_LOGIN=false` and no `VITE_GOOGLE_CLIENT_ID`: onboarding starts at INSTALLING phase (skips AUTH)
- [ ] With valid `VITE_GOOGLE_CLIENT_ID`: Google auth button appears, login works
- [ ] Configuration form validates required fields
- [ ] After config submit: configure + launch API calls succeed
- [ ] DeploymentProgress shows real container logs
- [ ] On container running: auto-transitions to COMPLETE
- [ ] "Open Chat Session" button redirects to Chat tab
- [ ] Chat auto-connects to the deployed container
- [ ] "Go to Dashboard" button goes to dashboard without auto-connect
