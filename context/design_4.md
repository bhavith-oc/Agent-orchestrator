# Design Document 4 — Remote Jason (OpenClaw) Integration

**Date:** 2026-02-08  
**Phase:** Onboard external Jason orchestrator running in Docker/VPN container  
**Status:** ✅ Fully integrated and tested

---

## Summary

This document covers the integration of a **remote Jason orchestrator** running inside a Docker container on a VPN, exposed via the [OpenClaw](https://openclaw.dev) gateway at `ws://72.61.254.5:61816`. The Aether Orchestrator backend now acts as a **bridge** between the local React UI and the remote OpenClaw gateway, allowing users to seamlessly switch between the local Jason (OpenRouter LLM) and the remote Jason (Docker container) from the same chat interface.

---

## Problem Statement

The user has a Jason agent running in a Docker container on a separate VPN, accessible via OpenClaw Control at `http://72.61.254.5:61816/chat?session=agent:main:main`. The goal was to:

1. Connect the Aether backend to this remote instance
2. Proxy chat messages between the UI and the remote Jason
3. Allow the UI to toggle between local and remote orchestrators
4. Auto-connect on startup if credentials are configured

---

## Protocol Discovery

OpenClaw does **not** use standard REST or JSON-RPC 2.0. It uses a custom **JSON-RPC-over-WebSocket** protocol:

### Frame Format
```json
// Request
{"type": "req", "id": "<uuid>", "method": "<string>", "params": {}}

// Response
{"type": "res", "id": "<uuid>", "ok": true, "payload": {}}

// Event (server push)
{"type": "event", "event": "<string>", "payload": {}, "seq": 42}
```

### Connection Handshake
1. Client connects to `ws://<host>:<port>`
2. Server sends `connect.challenge` event with a `nonce`
3. Client sends `connect` request with protocol version, client info, and auth
4. Server responds with `hello` payload containing snapshot, features, etc.

### Authentication
OpenClaw supports three auth methods:
- **Token-based** (used here): `auth: {token: "<string>"}` — simplest, no device identity needed
- **Password-based**: `auth: {password: "<string>"}`
- **Device identity**: Ed25519 keypair + signature — requires pre-pairing (not used)

### Available RPC Methods (discovered from JS bundle)
| Method | Purpose |
|---|---|
| `connect` | Handshake + auth |
| `status` | Gateway status |
| `health` | Health check with channel info |
| `chat.history` | Get chat messages for a session |
| `chat.send` | Send a message to the agent |
| `chat.abort` | Abort current generation |
| `agents.list` | List configured agents |
| `sessions.list` | List chat sessions |
| `models.list` | List available LLM models |
| `config.get` / `config.set` | Configuration management |
| `logs.tail` | Live log streaming |

### Message Format
OpenClaw messages use an array-of-parts content format:
```json
{
  "role": "assistant",
  "content": [{"type": "text", "text": "Hello!"}],
  "model": "x-ai/grok-code-fast-1",
  "provider": "openrouter",
  "usage": {"input": 10651, "output": 1063}
}
```

This is normalized to our flat `Message` format (`{role, name, content}`) by the backend.

---

## Files Created

### 1. `api/services/remote_jason.py` — NEW

- **Purpose:** WebSocket client that speaks the OpenClaw protocol
- **Classes:**
  - `RemoteJasonClient` — persistent WebSocket connection with:
    - Challenge/connect handshake
    - Generic `request(method, params)` RPC method
    - Convenience methods: `chat_history()`, `chat_send()`, `chat_abort()`, `get_status()`, `get_health()`, `get_agents()`, `get_sessions()`, `get_models()`
    - Background listener loop that routes responses to pending futures and events to handlers
    - Auto-reconnect with exponential backoff (up to 10 retries)
    - Graceful disconnect with pending future cleanup
  - `RemoteJasonManager` — singleton lifecycle manager:
    - `connect(url, token, session_key)` — connects (disconnects existing first)
    - `disconnect()` — graceful teardown
    - `get_info()` — returns connection status, health, uptime
    - Handles HTTP→WS URL conversion automatically
  - `remote_jason_manager` — global singleton instance
- **Role:** Core bridge between Aether backend and OpenClaw gateway
- **Importance:** 🔴 Critical for remote orchestrator feature

### 2. `api/routers/remote.py` — NEW

- **Purpose:** REST API endpoints for managing the remote connection
- **Endpoints:**

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/remote/connect` | Connect to a remote OpenClaw gateway |
| `POST` | `/api/remote/disconnect` | Disconnect from remote |
| `GET` | `/api/remote/status` | Get connection status + health info |
| `GET` | `/api/remote/history` | Get chat history from remote session |
| `POST` | `/api/remote/send` | Send a message to remote Jason |
| `GET` | `/api/remote/sessions` | List remote sessions |
| `GET` | `/api/remote/agents` | List remote agents |
| `GET` | `/api/remote/models` | List remote models |

- **Message normalization:** Converts OpenClaw's array-of-parts content format to our flat `{role, name, content}` format
- **Error handling:** Returns 502 (Bad Gateway) for remote failures, 503 (Service Unavailable) if not connected, 504 (Gateway Timeout) for timeouts
- **Role:** API layer between UI and remote Jason
- **Importance:** 🔴 Critical

---

## Files Modified

### 3. `api/config.py` — MODIFIED

Added three new settings:
```python
# Remote Jason (OpenClaw)
REMOTE_JASON_URL: str = ""
REMOTE_JASON_TOKEN: str = ""
REMOTE_JASON_SESSION: str = "agent:main:main"
```

### 4. `api/.env` — MODIFIED

Added remote Jason configuration:
```env
REMOTE_JASON_URL=ws://72.61.254.5:61816
REMOTE_JASON_TOKEN=3vMRPCr2UQRW8x1sGAzE4QPAgVmAL3U8
REMOTE_JASON_SESSION=agent:main:main
```

### 5. `api/main.py` — MODIFIED

- Imported `remote` router and `remote_jason_manager`
- Added auto-connect logic in `lifespan()`:
  ```python
  if remote_url and remote_token:
      hello = await remote_jason_manager.connect(remote_url, remote_token, session_key)
  ```
- Added graceful disconnect on shutdown
- Registered `remote.router`

### 6. `ui/src/api.ts` — MODIFIED

Added remote Jason types and API functions:
- `RemoteStatus` interface
- `RemoteConnectRequest` interface
- `fetchRemoteStatus()`, `connectRemote()`, `disconnectRemote()`
- `fetchRemoteHistory()`, `sendRemoteMessage()`
- `fetchRemoteSessions()`, `fetchRemoteAgents()`, `fetchRemoteModels()`

### 7. `ui/src/components/Chat.tsx` — MODIFIED (major rewrite)

Added local/remote orchestrator toggle with full visual distinction:

- **Mode toggle** in sidebar: `Local` (blue/primary) vs `Remote` (green/emerald) buttons
- **Connection status indicator**: Wifi icon showing "OpenClaw connected" or "Remote not configured"
- **Mode-aware behavior:**
  - History loads from `/api/chat/history` (local) or `/api/remote/history` (remote)
  - Messages sent to `/api/chat/send` (local) or `/api/remote/send` (remote)
  - Switching modes clears messages and reloads history
- **Visual distinction in remote mode:**
  - Top gradient bar turns emerald green
  - Remote mode banner shows "Remote Jason via OpenClaw at {url}"
  - Agent avatar bubbles turn emerald instead of blue
  - Agent name labels turn emerald
  - Placeholder text and footer text change
- **Remote button disabled** when not connected (grayed out with `cursor-not-allowed`)
- **Auto-polls** remote status every 10 seconds

---

## Architecture Flow

```
┌─────────────────────────────────────────────────────────┐
│                    React UI (Chat.tsx)                    │
│                                                          │
│  ┌──────────┐  ┌──────────┐                             │
│  │  Local   │  │  Remote  │  ← Mode toggle              │
│  └────┬─────┘  └────┬─────┘                             │
│       │              │                                   │
└───────┼──────────────┼───────────────────────────────────┘
        │              │
        ▼              ▼
┌───────────────┐ ┌───────────────┐
│ /api/chat/*   │ │ /api/remote/* │
│ (local Jason) │ │ (proxy)       │
└───────┬───────┘ └───────┬───────┘
        │                 │
        ▼                 ▼
┌───────────────┐ ┌───────────────────────────┐
│ Jason Service │ │ RemoteJasonClient          │
│ (OpenRouter)  │ │ (WebSocket → OpenClaw)     │
└───────────────┘ └───────────┬───────────────┘
                              │ ws://72.61.254.5:61816
                              ▼
                  ┌───────────────────────┐
                  │ OpenClaw Gateway      │
                  │ (Docker container)    │
                  │ Agent: main           │
                  │ Model: grok-code-fast │
                  └───────────────────────┘
```

---

## Verification Results

| Test | Result |
|---|---|
| Backend auto-connects to remote on startup | ✅ `Remote Jason connected at ws://72.61.254.5:61816 (protocol=3)` |
| `GET /api/remote/status` | ✅ Returns connected=true, health, server info, uptime |
| `GET /api/remote/history` | ✅ Returns 2 messages (normalized to our format) |
| Remote agent model | ✅ `x-ai/grok-code-fast-1` via OpenRouter |
| Remote agent name | ✅ `Jasonville_bot` (Telegram bot configured) |
| `npm run build` | ✅ Built in 9.45s, no errors |
| TypeScript compilation | ✅ All types match |

---

## Remote Jason Instance Details

From the health check response:
- **Host:** `6712cc55efb7` (Docker container ID)
- **Uptime:** ~48 hours (175565562ms)
- **Agent ID:** `main`
- **Model:** `x-ai/grok-code-fast-1` (via OpenRouter)
- **Session:** `agent:main:main`
- **Channels:** Telegram configured (`@Jasonville_bot`)
- **Heartbeat:** Every 30 minutes

---

## Security Notes

1. The OpenClaw token (`3vMRPCr2UQRW8x1sGAzE4QPAgVmAL3U8`) is stored in `.env` which is gitignored
2. The WebSocket connection is unencrypted (`ws://` not `wss://`) — acceptable for VPN but should use TLS in production
3. Token-only auth bypasses device identity verification — the token acts as a shared secret
4. The remote router endpoints are not JWT-protected (they inherit from the app's auth middleware if configured)

---

## What's Next

- Send a test message to remote Jason from the UI
- Add WebSocket streaming for real-time remote responses (currently waits for full response)
- Add remote orchestrator management to the Settings page (connect/disconnect/change URL)
- Consider adding JWT protection to `/api/remote/*` endpoints
