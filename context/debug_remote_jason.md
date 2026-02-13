# Debug Log — Remote Jason (OpenClaw) Integration

**Date:** 2026-02-08  
**Feature Request:** Onboard a remote Jason orchestrator running in a Docker container on a VPN  
**Remote URL:** `http://72.61.254.5:61816/chat?session=agent%3Amain%3Amain`  
**Status:** ✅ Resolved — fully integrated

---

## 1. Feature Request

The user asked:
> "Do you think its possible to also onboard the main jason orchestrator, if its in a separate VPN on a container? I have jason container running in docker container exposed here http://72.61.254.5:61816/chat?session=agent%3Amain%3Amain, do you think its possible to onboard orchestrator and also have that support in UI?"

**Goal:** Connect the local Aether Orchestrator to a remote Jason instance running inside a Docker container, accessible over a VPN, and allow the UI to talk to it.

---

## 2. Debug Steps — Protocol Discovery

### Step 2.1: Initial probe of the remote URL

**Action:** `curl -s -v http://72.61.254.5:61816/chat?session=agent%3Amain%3Amain`

**Finding:** The response was an HTML page for **OpenClaw Control** — a web-based chat UI. This told us:
- It's NOT a simple REST API
- It's a full web application with a frontend
- The actual communication likely happens over WebSocket

**Key HTML clue:**
```html
<title>OpenClaw Control</title>
<script>
  window.__OPENCLAW_CONTROL_UI_BASE_PATH__="";
  window.__OPENCLAW_ASSISTANT_NAME__="Assistant";
</script>
```

### Step 2.2: Extract API routes from JS bundle

**Action:** Downloaded and analyzed the minified JS bundle at `/assets/index-CYRpW51H.js`

**Command:**
```bash
curl -s http://72.61.254.5:61816/assets/index-CYRpW51H.js | grep -oE '"/[a-zA-Z0-9/_-]+"' | sort -u
```

**Finding:** Discovered UI route paths:
```
/agents, /channels, /chat, /config, /cron, /debug,
/import, /instances, /logs, /new, /nodes, /overview,
/reset, /sessions, /skills, /stop
```

### Step 2.3: Extract RPC method names from JS bundle

**Action:** Searched for `client.request("` patterns in the JS bundle

**Command:**
```bash
curl -s http://72.61.254.5:61816/assets/index-CYRpW51H.js | tr ',' '\n' | grep -i 'client.request' | grep -oP '"[a-z._]+"' | sort -u
```

**Finding:** Discovered 40+ RPC methods:
```
"agent.identity.get", "agents.files.get", "agents.files.list",
"agents.files.set", "agents.list", "channels.logout",
"channels.status", "chat.abort", "chat.history", "chat.send",
"config.apply", "config.get", "config.schema", "config.set",
"connect", "cron.add", "cron.list", "cron.remove", "cron.run",
"cron.runs", "cron.status", "cron.update", "device.pair.approve",
"device.pair.list", "device.pair.reject", "device.token.revoke",
"device.token.rotate", "exec.approval.resolve", "health",
"logs.tail", "models.list", "node.list", "sessions.delete",
"sessions.list", "sessions.patch", "skills.install",
"skills.status", "skills.update", "status", "update.run",
"web.login.start", "web.login.wait"
```

**Key insight:** This is a **JSON-RPC over WebSocket** protocol, NOT REST.

### Step 2.4: Discover WebSocket URL pattern

**Action:** Searched for WebSocket construction in JS bundle

**Finding:**
```javascript
gatewayUrl: `${location.protocol==="https:"?"wss":"ws"}://${location.host}`
```

So the WebSocket URL is simply `ws://72.61.254.5:61816` (same host, root path).

### Step 2.5: Discover frame format

**Action:** Found the `request()` method in the JS bundle

**Finding:** NOT standard JSON-RPC 2.0. Custom frame format:
```javascript
// Request frame
{type: "req", id: <uuid>, method: <string>, params: <object>}

// Response frame
{type: "res", id: <uuid>, ok: <bool>, payload|error: <object>}

// Event frame (server push)
{type: "event", event: <string>, payload: <object>, seq: <number>}
```

### Step 2.6: Discover connect handshake

**Action:** Extracted the `sendConnect()` function from the JS bundle

**Finding:** The connection flow is:
1. Client opens WebSocket
2. Server sends `connect.challenge` event with a `nonce`
3. Client sends `connect` RPC with protocol version, client info, auth
4. Server responds with `hello` payload

The connect params structure:
```javascript
{
  minProtocol: 3, maxProtocol: 3,
  client: {id: "openclaw-control-ui", version: "dev", platform: "web", mode: "webchat"},
  role: "operator",
  scopes: ["operator.admin", "operator.approvals", "operator.pairing"],
  device: {id, publicKey, signature, signedAt, nonce},  // Ed25519
  caps: [],
  auth: {token: <string>, password: <string>},
  userAgent: navigator.userAgent,
  locale: navigator.language
}
```

### Step 2.7: Discover valid client IDs

**Action:** Searched for client ID constants in JS bundle

**Finding:**
```javascript
const Cl = {
  WEBCHAT_UI: "webchat-ui",
  CONTROL_UI: "openclaw-control-ui",
  WEBCHAT: "webchat",
  CLI: "cli",
  GATEWAY_CLIENT: "gateway-client",
  MACOS_APP: "openclaw-macos",
  IOS_APP: "openclaw-ios",
  ANDROID_APP: "openclaw-android",
  NODE_HOST: "node-host",
  TEST: "test",
  FINGERPRINT: "fingerprint",
  PROBE: "openclaw-probe"
}
```

---

## 3. Debug Steps — Connection Attempts

### Attempt 1: Basic WebSocket connect

**Action:** Python script using `websockets` library

**Result:** ✅ Connected, received challenge:
```json
{"type":"event","event":"connect.challenge","payload":{"nonce":"f9f2a72c-..."}}
```

### Attempt 2: Send connect with JSON-RPC 2.0 format

**Action:** Sent `{jsonrpc: "2.0", method: "connect", id: 1, ...}`

**Result:** ❌ `ConnectionClosedError: received 1008 (policy violation) invalid request frame`

**Root cause:** OpenClaw uses `{type: "req"}` format, NOT JSON-RPC 2.0.

### Attempt 3: Correct frame format, wrong client ID

**Action:** Sent `{type: "req", method: "connect", params: {client: {id: "aether-orchestrator"}}}`

**Result:** ❌ `invalid connect params: at /client/id: must be equal to constant; must match a schema in anyOf`

**Root cause:** `client.id` must be one of the predefined constants (see Step 2.7).

### Attempt 4: Correct client ID, nonce at root level

**Action:** Used `client.id: "gateway-client"`, put `nonce` in root params

**Result:** ❌ `invalid connect params: at root: unexpected property 'nonce'`

**Root cause:** `nonce` is only used internally by the client for device signature, not sent as a root param.

### Attempt 5: Removed nonce, auth set to null

**Action:** Set `auth: null`

**Result:** ❌ `invalid connect params: at /auth: must be object`

**Root cause:** `auth` must be an object `{}`, not `null`.

### Attempt 6: Empty auth object, no device identity

**Action:** Set `auth: {}`, no `device` field

**Result:** ❌ `device identity required`

**Root cause:** Server requires either device identity OR token auth.

### Attempt 7: Device identity with fresh Ed25519 keypair

**Action:** Generated Ed25519 keypair, computed device ID as SHA-256 of public key, signed the connect payload

**Result:** ❌ `device identity mismatch`

**Root cause:** The server only accepts **pre-paired** devices. A fresh keypair is unknown to the server.

### Attempt 8: Token-only auth (no device identity) ✅

**Action:** Asked user for token. Used `auth: {token: "3vMRPCr2UQRW8x1sGAzE4QPAgVmAL3U8"}`, no `device` field.

**Result:** ✅ `Connect ok: True`

**Key insight:** Token-based auth bypasses device identity requirement entirely.

---

## 4. Debug Steps — API Verification

### Test: Get status
```bash
# RPC: status
Result: {heartbeat, channelSummary, sessions}
```

### Test: Get agents
```bash
# RPC: agents.list
Result: {defaultId: "main", mainKey: "main", agents: [...]}
```

### Test: Get chat history
```bash
# RPC: chat.history {sessionKey: "agent:main:main"}
Result: {sessionKey, sessionId, messages: [2 messages], thinkingLevel}
# Last message: role=assistant, model=x-ai/grok-code-fast-1, provider=openrouter
```

### Test: Get sessions
```bash
# RPC: sessions.list
Result: {sessions: [{key: "agent:main:main", kind: "direct", ...}]}
```

All API methods work correctly with token auth.

---

## 5. Information Requested from User

| # | Question | User Response |
|---|---|---|
| 1 | Auth method: token/password, pair from browser, or disable device auth? | "I have a token/password" |
| 2 | Please provide the token | `3vMRPCr2UQRW8x1sGAzE4QPAgVmAL3U8` |

---

## 6. Message Format Discovery

OpenClaw uses an **array-of-parts** content format:
```json
{
  "role": "assistant",
  "content": [{"type": "text", "text": "Hey. I just came online."}],
  "model": "x-ai/grok-code-fast-1",
  "provider": "openrouter",
  "usage": {"input": 10651, "output": 1063}
}
```

This needed normalization to our flat format:
```json
{
  "role": "agent",
  "name": "Remote Jason",
  "content": "Hey. I just came online.",
  "model": "x-ai/grok-code-fast-1"
}
```

The normalization logic extracts `text` from content parts where `type === "text"` and joins them with newlines.

---

## 7. Files Created During This Session

### Backend
| File | Purpose |
|---|---|
| `api/services/remote_jason.py` | WebSocket client for OpenClaw protocol |
| `api/routers/remote.py` | REST API proxy (8 endpoints) |

### Modified
| File | Change |
|---|---|
| `api/config.py` | Added REMOTE_JASON_URL/TOKEN/SESSION settings |
| `api/.env` | Added remote Jason credentials |
| `api/main.py` | Auto-connect on startup, register router |
| `ui/src/api.ts` | Added remote API types + functions |
| `ui/src/components/Chat.tsx` | Local/Remote toggle with visual distinction |

### Documentation
| File | Purpose |
|---|---|
| `context/design_4.md` | Architecture + file documentation |
| `context/debug_remote_jason.md` | This file — debug log |

### Helper Functions
| File | Purpose |
|---|---|
| `helper-function/openclaw_ws_test.py` | Standalone test script for OpenClaw WebSocket |

---

## 8. Key Lessons Learned

1. **Always check the JS bundle** when reverse-engineering a web app's API — the minified source reveals all RPC methods, frame formats, and auth flows
2. **OpenClaw uses a custom protocol**, not JSON-RPC 2.0 or REST — the frame format is `{type: "req"|"res"|"event"}`
3. **Token auth is the simplest path** — device identity requires Ed25519 keypair + pre-pairing, which is complex
4. **Client ID must be a known constant** — `"gateway-client"` works for backend integrations
5. **Content normalization is required** — OpenClaw uses array-of-parts, our UI expects flat strings
