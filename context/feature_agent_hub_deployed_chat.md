# Feature: Agent Hub — Deployed Container Chat + Session Names

**Date:** 2026-02-10
**Status:** Implemented & Tested
**Severity:** High — Agent Hub was broken, now fully functional

---

## Problem Statement

The Agent Hub page was broken because:

1. **"Local" mode required `OPENROUTER_API_KEY`** in the backend's own `api/.env` — which the user doesn't have configured. This made the entire Local mode unusable.
2. **No way to chat with deployed containers** — The user has running OpenClaw containers (deployed via Deploy Agent page) but the Agent Hub had no mechanism to connect to them.
3. **"Remote" mode** only connects to one external OpenClaw gateway (auto-configured at startup). It doesn't connect to locally deployed containers.

**Result:** The Agent Hub showed a broken state — Local disabled, and no path to chat with the user's own deployed agents.

## Design Decision

### Before (broken)
```
Agent Hub Modes:
  Local  → backend's own Jason (requires OPENROUTER_API_KEY in api/.env) — BROKEN
  Remote → external OpenClaw gateway (ws://72.61.254.5:61816) — works
```

### After (fixed)
```
Agent Hub Modes:
  Deployed → connects to any running container from Deploy Agent page — NEW
  Remote   → external OpenClaw gateway — unchanged
```

### Key Design Choices

1. **Replaced "Local" with "Deployed"** — Instead of requiring a separate API key in the backend, the Agent Hub now connects directly to the user's deployed containers via WebSocket, reusing the same `RemoteJasonClient` protocol.

2. **Session Names** — Each chat connection gets a meaningful auto-generated name (e.g., "Phantom Orbit", "Stellar Nexus") from a pool of adjective+noun combinations. Users can also provide custom names.

3. **Deployment Selector** — When in "Deployed" mode, a dropdown shows all running containers. User selects one and clicks "Connect" to establish the WebSocket connection.

4. **Remote mode untouched** — The existing Remote mode continues to work exactly as before.

---

## Architecture

### New Backend Files

#### `api/services/deployment_chat.py`

**Purpose:** Manages chat connections to locally deployed OpenClaw containers.

**Key components:**
- `generate_session_name()` — Generates names like "Crimson Falcon" from 24 adjectives × 24 nouns (576 combinations)
- `DeploymentChatManager` class:
  - `connect(deployment_id, session_name?)` — Looks up port/token from deployer, creates `RemoteJasonClient`, performs WS handshake
  - `disconnect()` — Closes WS connection
  - `get_status()` — Returns connection info + session name
  - `send_message(content)` — Sends message, polls for response, normalizes output
  - `get_history()` — Gets chat history, normalizes to `Message` format
- `deployment_chat_manager` — Singleton instance

**How it works:**
```
User selects deployment → connect(deployment_id)
  → deployer._active_deployments[id] → get port + token
  → RemoteJasonClient(ws://localhost:{port}, token)
  → client.connect() → WS handshake → ready to chat
```

#### `api/routers/deploy_chat.py`

**Purpose:** REST endpoints for the deployment chat feature.

**Endpoints:**
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/deploy-chat/connect` | Connect to a deployed container |
| POST | `/api/deploy-chat/disconnect` | Disconnect from current deployment |
| GET | `/api/deploy-chat/status` | Get connection status + session name |
| GET | `/api/deploy-chat/history` | Get chat history from connected deployment |
| POST | `/api/deploy-chat/send` | Send a message and get response |

### Modified Backend Files

#### `api/main.py`
- Added `deploy_chat` router import and registration
- Added `deployment_chat_manager.disconnect()` on shutdown

### Frontend Changes

#### `ui/src/api.ts`
Added types and functions:
- `DeployChatStatus` interface
- `DeployChatConnectResult` interface
- `connectDeployChat()`, `disconnectDeployChat()`, `fetchDeployChatStatus()`, `fetchDeployChatHistory()`, `sendDeployChatMessage()`

#### `ui/src/components/Chat.tsx` — Major Rewrite

**Mode toggle:** "Local"/"Remote" → "Deployed"/"Remote"
- "Deployed" button shows count of running deployments
- Disabled with tooltip when no deployments are running

**Deployment selector (new):**
- Dropdown of running deployments (shows ID + port)
- "Connect" button to establish WS connection
- When connected: shows session name with green pulsing dot + "Disconnect" button

**Auto-behaviors:**
- Auto-switches to Remote if no running deployments exist
- Auto-selects first running deployment
- Input disabled when not connected

**Session name display:**
- Shown in mode indicator bar at top of chat area
- Shown in footer status text
- Used as agent name in message bubbles

---

## Testing

### Test 1: Deploy-chat connect

**Command:**
```bash
$ curl -s -X POST http://localhost:8000/api/deploy-chat/connect \
  -H "Content-Type: application/json" \
  -d '{"deployment_id": "e2263cc644"}'
```

**Output:**
```json
{
    "connected": true,
    "deployment_id": "e2263cc644",
    "session_name": "Phantom Orbit",
    "port": 18419,
    "protocol": 3,
    "server": {"version": "dev", "host": "418e1aa1a45f", ...}
}
```

**Reasoning:** The manager looked up deployment `e2263cc644` from the deployer, found port=18419 and token=`fc98bccf...`, created a `RemoteJasonClient`, connected via `ws://localhost:18419`, completed the OpenClaw handshake (protocol 3), and generated session name "Phantom Orbit".

### Test 2: Deploy-chat status

**Command:**
```bash
$ curl -s http://localhost:8000/api/deploy-chat/status
```

**Output:**
```json
{
    "connected": true,
    "deployment_id": "e2263cc644",
    "session_name": "Phantom Orbit",
    "port": 18419,
    "url": "ws://localhost:18419"
}
```

### Test 3: Deploy-chat history

**Command:**
```bash
$ curl -s http://localhost:8000/api/deploy-chat/history | python3 -c "..."
```

**Output:**
```
2 messages in history
```

**Reasoning:** The deployment had 2 messages from a previous webchat session.

### Test 4: Send sample message to deployed agent

**Command:**
```bash
$ curl -s --max-time 120 -X POST http://localhost:8000/api/deploy-chat/send \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello! What can you do?"}'
```

**Output:**
```json
{
    "role": "agent",
    "name": "Phantom Orbit",
    "content": "Hey. I just came online. Who am I? Who are you?\n\nWhat can I do? I'm an AI assistant running on OpenClaw — think of me as your resourceful sidekick. I can help with tasks like reading/writing files, running commands, searching the web, managing cron jobs, controlling browsers or canvases, sending messages, and more...",
    "model": "x-ai/grok-code-fast-1"
}
```

**Reasoning:** The message was sent via `chat.send` RPC to the OpenClaw gateway. The gateway forwarded it to the Grok model via OpenRouter. The response was polled via `chat.history` until a new assistant message with text content appeared. The response was normalized to our `Message` format with the session name as the agent name.

### Test 5: Disconnect and reconnect with custom name

**Commands:**
```bash
$ curl -s -X POST http://localhost:8000/api/deploy-chat/disconnect
→ {"ok": true, "message": "Disconnected from deployment"}

$ curl -s http://localhost:8000/api/deploy-chat/status
→ {"connected": false, "deployment_id": null, "session_name": null}

$ curl -s -X POST http://localhost:8000/api/deploy-chat/connect \
  -H "Content-Type: application/json" \
  -d '{"deployment_id": "e2263cc644", "session_name": "Evening Debug Session"}'
→ {"connected": true, "session_name": "Evening Debug Session", ...}
```

### Test 6: Remote mode (unchanged, still works)

**Command:**
```bash
$ curl -s http://localhost:8000/api/remote/status | python3 -c "..."
```

**Output:**
```
connected: True, url: ws://72.61.254.5:61816, protocol: 3
66 messages in history
```

**Command:**
```bash
$ curl -s -X POST http://localhost:8000/api/remote/send \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello team, testing remote mode"}'
```

**Output:**
```json
{
    "role": "agent",
    "name": "System",
    "content": "💬 Message sent to team chat. Tag **@jason** to assign a task."
}
```

**Reasoning:** Remote mode is completely untouched. The existing `remote_jason_manager` handles the external OpenClaw gateway connection independently of the new `deployment_chat_manager`.

---

## Session Name Generator

Located in `api/services/deployment_chat.py`.

**Pool:** 24 adjectives × 24 nouns = 576 unique combinations.

**Sample adjectives:** Crimson, Stellar, Quantum, Neural, Cosmic, Phantom, Radiant, Obsidian, Emerald, Sapphire, Titanium, Velvet, Arctic, Solar, Lunar, Thunder, Crystal, Shadow, Neon, Amber, Cobalt, Ivory, Onyx, Prism

**Sample nouns:** Falcon, Horizon, Nexus, Cipher, Vortex, Phoenix, Sentinel, Catalyst, Beacon, Forge, Pulse, Echo, Vertex, Orbit, Zenith, Aegis, Flux, Nova, Helix, Apex, Drift, Core, Arc, Spark

**Examples:** "Phantom Orbit", "Stellar Nexus", "Crimson Falcon", "Neural Beacon"

Users can also provide custom session names via the `session_name` parameter.

---

## Files Created/Modified

| File | Action | Description |
|------|--------|-------------|
| `api/services/deployment_chat.py` | **Created** | DeploymentChatManager + session name generator |
| `api/routers/deploy_chat.py` | **Created** | 5 REST endpoints for deploy-chat |
| `api/main.py` | Modified | Register deploy_chat router, add shutdown cleanup |
| `ui/src/api.ts` | Modified | Add DeployChatStatus, DeployChatConnectResult types + 5 API functions |
| `ui/src/components/Chat.tsx` | Modified | Replace Local/Remote with Deployed/Remote, add deployment selector, session name display |

---

## Helper Code

### `helper-functions/debug_verify_deploy_token.sh`
Previously created helper script that verifies gateway token match between `.env` and running container. Useful for debugging "gateway token mismatch" errors when deploy-chat connect fails.

**Usage:**
```bash
$ bash helper-functions/debug_verify_deploy_token.sh e2263cc644
```
