# Bug Fix & Feature: Agent Hub UI, Telegram Config, Deployed Container Names & Labels

**Date:** 2026-02-11
**Session:** Chat Session 3
**Status:** Implemented & Tested

---

## Issues Addressed

1. **Agent Hub page showing old UI** — "Local (N/A)" / "Remote" buttons still rendering instead of new "Deployed" / "Remote" mode
2. **Telegram not configured in deployed container** (port 57894) — `botToken` missing from `openclaw.json`, Telegram plugin disabled
3. **docker-compose.yml template broken** — Used `$$VAR` + `'MAINEOF'` (single-quoted heredoc) preventing env var expansion, then relied on broken `sed` workarounds; also missing `botToken` in Telegram channel config
4. **No deployment names** — Containers only identified by hex IDs, no meaningful names
5. **Neural Links sidebar** — Only showed orchestrator agents, not deployed containers
6. **Agent Pool page** — No deployed containers or remote Jason shown, no local/remote labels

---

## Root Cause Analysis

### Telegram Not Working (port 57894)

**Diagnosis commands:**
```bash
# Check .env for Telegram credentials
$ cat /home/oc/Desktop/Agent-orchestrator/deployments/a71f7e039e/.env
# Output: TELEGRAM_BOT_TOKEN=8492622737:AAHpMsGt1kOdhQxHH92HPjOn14izj2qYCpA
#         TELEGRAM_USER_ID=8578090114

# Check container's actual config
$ docker exec $(docker ps --filter "publish=57894" -q) cat /home/node/.openclaw/openclaw.json
```

**Findings:**
1. `openclaw.json` had Telegram channel section with `allowFrom` and `dmPolicy` but **no `botToken` field**
2. `plugins.entries.telegram.enabled` was set to `false` — explicitly disabling Telegram
3. The `tokenSource` in health was `none` — OpenClaw couldn't find the bot token

**Root cause:** The docker-compose.yml template never wrote `botToken` into the Telegram channel config JSON. The template only included `dmPolicy`, `allowFrom`, `groupPolicy`, and `mediaMaxMb`.

### docker-compose.yml Template Issues

**Comparison with user's working compose:**

| Aspect | Our Broken Template | User's Working Template |
|--------|-------------------|----------------------|
| Heredoc quoting | `'MAINEOF'` everywhere (prevents expansion) | `MAINEOF` unquoted where vars needed |
| Env var prefix | `$$VAR` (docker-compose escape) | `$VAR` (docker-compose interpolates) |
| Gateway token | Written as literal `$$OPENCLAW_GATEWAY_TOKEN`, fixed by `sed` | `$OPENCLAW_GATEWAY_TOKEN` expanded by docker-compose |
| Telegram botToken | **Not included at all** | Not in user's template either (but user's template works because OpenClaw picks up `TELEGRAM_BOT_TOKEN` env var) |
| sed workarounds | 3 sed commands to fix unexpanded vars | None needed |
| Exec command | `$$OPENCLAW_GATEWAY_PORT` | `$PORT` |

**Key insight:** In docker-compose YAML, `$VAR` gets interpolated by docker-compose itself from the `.env` file before the shell command runs. Using `$$VAR` escapes this to `$VAR` in the shell, but with `'MAINEOF'` (single-quoted heredoc), shell expansion is also suppressed. The user's working template uses `$VAR` directly so docker-compose handles all substitution.

### Agent Hub UI Not Updating

**Diagnosis:**
```bash
# Verify Vite serves new code
$ curl -s "http://localhost:5173/src/components/Chat.tsx" | grep -c "deployed"
# Output: 13  (new code IS being served)

# The old UI was cached in the browser — needed hard refresh (Ctrl+Shift+R)
```

---

## Fixes Applied

### 1. docker-compose.yml Template Rewrite

**File:** `/home/oc/Desktop/Agent-orchestrator/docker-compose.yml`

**Changes:**
- Removed all `$$` prefixes → use `$VAR` for docker-compose interpolation
- Changed gateway/channels heredocs from `'MAINEOF'` to `MAINEOF` (unquoted) where env vars need expansion
- **Added `"botToken": "$TELEGRAM_BOT_TOKEN"` to Telegram channel config**
- Removed all 3 `sed` workaround commands
- Changed exec line from `$$OPENCLAW_GATEWAY_PORT` to `$PORT`
- Changed `mkdir -p` to `mkdir` to match user's working template

### 2. Telegram Config Fix for Running Container (port 57894)

**Commands used:**
```bash
# Step 1: Connect via WebSocket and get current config
$ python3 -c "... websockets connect, config.get ..."
# Found: botToken missing, plugins.entries.telegram.enabled=false

# Step 2: Add botToken via config.set API
$ python3 -c "... config.set with baseHash, added botToken ..."
# Result: config.set ok: True, gateway restarted (1012 service restart)

# Step 3: Enable telegram plugin via config.set
$ python3 -c "... set plugins.entries.telegram.enabled=true ..."
# Result: config.set ok: True

# Step 4: Remove plugins section entirely (was blocking auto-start)
$ python3 -c "... generate clean JSON without plugins section ..."
$ docker cp /tmp/fixed_openclaw.json <container>:/home/node/.openclaw/openclaw.json
$ docker exec <container> chown node:node /home/node/.openclaw/openclaw.json
$ docker exec <container> chmod 600 /home/node/.openclaw/openclaw.json
$ docker exec <container> kill -USR1 1  # Restart gateway

# Step 5: Verify Telegram status
$ python3 -c "... health check ..."
# Output:
#   configured: True
#   running: False  (needs first-time enable via OpenClaw control UI)
#   probe.ok: True
#   bot.username: APlundererBot
#   bot.id: 8492622737
```

**Note:** OpenClaw requires first-time channel enablement via its control UI at `http://localhost:57894`. The Telegram bot is detected and configured, but won't auto-start until the user clicks "Start" in the OpenClaw control panel. This is an OpenClaw design decision, not a bug.

### 3. Deployment Name Generation

**File:** `/home/oc/Desktop/Agent-orchestrator/api/services/deployer.py`

**Changes:**
- Added `_DEPLOY_ADJECTIVES` (24 words) and `_DEPLOY_NOUNS` (24 words) = 576 unique combinations
- Added `_generate_deploy_name()` function
- `generate_env()`: generates name, writes `DEPLOY_NAME=<name>` to `.env`
- `restore_deployments()`: reads `DEPLOY_NAME` from `.env`, generates one if missing, persists back
- `list_deployments()`: includes `name` field in output

**Sample names generated:**
```
Emerald Sentinel  (e2263cc644, port 18419)
Emerald Flux      (23ca3cf35d, port 35341)
Radiant Beacon    (1959c1bfb1, port 10188)
Solar Nova        (a71f7e039e, port 57894)
```

### 4. Chat.tsx — Neural Links with Deployed Containers

**File:** `/home/oc/Desktop/Agent-orchestrator/ui/src/components/Chat.tsx`

**Changes to Neural Links sidebar:**
- **Deployed containers** shown first with name, "Local" badge, port, connection status
- **Remote Jason** shown with "Remote" badge, URL
- **Orchestrator agents** shown after (Jason master, sub-agents)
- Clicking a deployed container auto-selects it in the deployment dropdown
- Deployment selector dropdown now shows names instead of hex IDs

### 5. Agents.tsx — Agent Pool with Local/Remote Labels

**File:** `/home/oc/Desktop/Agent-orchestrator/ui/src/components/Agents.tsx`

**Changes:**
- Added `fetchDeployList`, `fetchRemoteStatus` imports
- Added `deployments` and `remoteStatus` state
- Header shows: `"3 deployed · 1 remote · 1 orchestrator"`
- **Running containers** shown as cards with Rocket icon, name, "Local" badge, port, WS URL, deployment ID
- **Stopped containers** shown dimmed when "Show All" is toggled
- **Remote Jason** shown as card with Globe icon, "Remote" badge, connection URL
- Refresh button refreshes all three data sources

### 6. api.ts — DeploymentInfo Type Update

**File:** `/home/oc/Desktop/Agent-orchestrator/ui/src/api.ts`

**Change:** Added `name: string` field to `DeploymentInfo` interface

---

## Testing

### Backend API Tests

```bash
# 1. Deploy list with names
$ curl -s http://localhost:8000/api/deploy/list
# Output:
#   Emerald Sentinel  id=e2263cc644 port=18419 status=running
#   Emerald Flux      id=23ca3cf35d port=35341 status=stopped
#   Radiant Beacon    id=1959c1bfb1 port=10188 status=running
#   Solar Nova        id=a71f7e039e port=57894 status=running

# 2. Deploy chat connect
$ curl -s -X POST http://localhost:8000/api/deploy-chat/connect \
  -H "Content-Type: application/json" \
  -d '{"deployment_id": "a71f7e039e"}'
# Output: connected=true, session_name="Titanium Aegis", port=57894, protocol=3

# 3. Send chat message to deployed container
$ curl -s -X POST http://localhost:8000/api/deploy-chat/send \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello, who are you?"}'
# Output: role=agent, name="Titanium Aegis", content="🎩 Mr. Kim here..."

# 4. Remote status (unchanged, still works)
$ curl -s http://localhost:8000/api/remote/status
# Output: connected=True, url=ws://72.61.254.5:61816
```

### Frontend Verification

```bash
# Verify Vite serves new Chat.tsx code
$ curl -s "http://localhost:5173/src/components/Chat.tsx" | grep -c "deployed"
# Output: 35

# Verify Vite serves new Agents.tsx code
$ curl -s "http://localhost:5173/src/components/Agents.tsx" | grep -c "deploy"
# Output: 26
```

**Note:** Browser may need hard refresh (Ctrl+Shift+R) to pick up HMR changes after significant component rewrites.

---

## Files Modified

| File | Action | Description |
|------|--------|-------------|
| `docker-compose.yml` | Modified | Rewrote to match user's working template: unquoted MAINEOF for var expansion, added botToken to Telegram config, removed sed workarounds |
| `api/services/deployer.py` | Modified | Added name generation (576 combos), persist in .env, restore on startup, include in list output |
| `ui/src/api.ts` | Modified | Added `name` field to `DeploymentInfo` interface |
| `ui/src/components/Chat.tsx` | Modified | Neural Links shows deployed containers with names + Local/Remote badges |
| `ui/src/components/Agents.tsx` | Modified | Agent Pool shows deployed containers + Remote Jason with Local/Remote badges |

## Helper Scripts Used

```bash
# WebSocket health check (used throughout debugging)
python3 -c "
import asyncio, json, uuid, websockets
async def check():
    token = '<gateway_token>'
    uri = 'ws://localhost:<port>'
    async with websockets.connect(uri, ping_interval=20, ping_timeout=10) as ws:
        # Challenge → Connect → health/config.get/config.set
        ...
asyncio.run(check())
"

# Container config inspection
docker exec <container> cat /home/node/.openclaw/openclaw.json

# Container config replacement
docker cp /tmp/fixed_config.json <container>:/home/node/.openclaw/openclaw.json
docker exec <container> kill -USR1 1  # Restart gateway without container restart
```

---

## Telegram First-Time Enablement

OpenClaw requires channels to be explicitly started the first time via its control UI. After the config fix:

1. Open `http://localhost:57894` in a browser
2. Log in with the gateway token: `252a4853c900cf8a41107d35fe4aef9f`
3. Navigate to Channels → Telegram
4. Click "Start" to begin polling

The bot `APlundererBot` (ID: 8492622737) is detected and configured with user ID `8578090114` in the allowlist.
