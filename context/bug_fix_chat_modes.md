# Bug Fix: Chat Modes (Local & Remote) — Agents Hub Page

**Date:** 2026-02-09  
**Status:** Fixed & Verified

---

## Overview

The Agents Hub (Chat) page has two modes — **Local** and **Remote** — toggled via the left sidebar. Both modes had issues preventing normal use.

---

## Bug 1: Remote Mode — "Failed to reach remote Jason"

### Symptom
Sending any message in Remote mode produced:
```
Failed to reach remote Jason. Check if the OpenClaw gateway is running.
```

### Root Cause
The `chat_send` method in `api/services/remote_jason.py` (line 140-144) was sending incorrect parameters to the OpenClaw `chat.send` RPC:

**Before (broken):**
```python
result = await self.request(
    "chat.send",
    {"sessionKey": key, "kind": "agentTurn", "message": message},
    timeout=120.0,
)
```

Two problems:
1. **Missing `idempotencyKey`** — OpenClaw requires this field for deduplication
2. **Invalid `kind` property** — OpenClaw does not accept this field

The OpenClaw API returned:
```
INVALID_REQUEST: invalid chat.send params: must have required property 'idempotencyKey'; at root: unexpected property 'kind'
```

Additionally, `chat.send` is **asynchronous** — it returns `{status: "started", runId: "..."}` immediately. The actual agent response arrives later and must be retrieved by polling `chat.history`.

### Fix Applied
- **File:** `api/services/remote_jason.py`
  - Removed `kind` parameter, added `idempotencyKey` (UUID)
  - Added `_poll_for_response()` method that polls `chat.history` until a new assistant message appears (1-3s intervals, 120s timeout)
- **File:** `api/routers/remote.py`
  - Simplified `send_to_remote` endpoint — `chat_send` now returns the assistant message directly after polling, so no need to re-fetch history

### Verification
```bash
curl -s -X POST http://localhost:8000/api/remote/send \
  -H 'Content-Type: application/json' \
  -d '{"content":"ping - just say OK"}'
# Returns: {"role":"agent","name":"Remote Jason","content":"OK","model":"x-ai/grok-code-fast-1","provider":"openrouter"}
```

---

## Bug 2: Local Mode — "OpenRouter API key not configured"

### Symptom
Sending any message in Local mode returned:
```
⚠️ **OpenRouter API key not configured.**
Set `OPENROUTER_API_KEY` in `api/.env` to a valid key from openrouter.ai and restart the backend.
```

### Root Cause
**Not a code bug** — this is working as designed. The `.env` file has a placeholder value:
```
OPENROUTER_API_KEY=your-openrouter-api-key-here
```

The guard in `api/services/jason.py` (line 90) correctly detects this:
```python
if not api_key or api_key == "your-openrouter-api-key-here":
    return "⚠️ **OpenRouter API key not configured.**..."
```

### UX Improvement Applied
The problem was that users had to **send a message first** to discover the API key wasn't configured. Now the Chat UI shows a **proactive warning banner** at the top of the chat area.

- **File:** `api/routers/chat.py`
  - Added `GET /api/chat/status` endpoint that returns configuration status:
    ```json
    {
      "ready": false,
      "mode": "conversational",
      "api_key_configured": false,
      "repo_configured": false,
      "model": "openai/gpt-4o",
      "issues": ["OpenRouter API key not configured..."]
    }
    ```
- **File:** `ui/src/api.ts`
  - Added `ChatStatus` type and `fetchChatStatus()` API function
- **File:** `ui/src/components/Chat.tsx`
  - Added `localStatus` state, checked on mount via `fetchChatStatus()`
  - Added amber warning banner when API key is not configured (with link to switch to Remote mode if connected)
  - Added red warning banner when Remote mode is selected but not connected
  - Updated empty-state message to guide users toward configuration or Remote mode

---

## How the Two Modes Work

| Feature | Local | Remote |
|---------|-------|--------|
| **Backend** | `api/services/jason.py` | `api/services/remote_jason.py` → OpenClaw WS |
| **LLM** | OpenRouter (requires API key in `.env`) | OpenClaw container's configured model |
| **Endpoint** | `POST /api/chat/send` | `POST /api/remote/send` |
| **History** | `GET /api/chat/history` (SQLite) | `GET /api/remote/history` (OpenClaw WS) |
| **Requires** | `OPENROUTER_API_KEY` in `.env` | Connected OpenClaw (Settings → Remote Config) |
| **Mode** | Conversational (no repo) or Orchestrator (with repo) | Always via remote agent |

---

## Bug 3: Remote Mode — Response Arriving 1 Message Late

### Symptom
When sending messages in Remote mode, the response displayed in the Chat UI was from the *previous* message, not the current one. Each response appeared to be "1 message behind."

### Root Cause
The `_poll_for_response` method in `api/services/remote_jason.py` was comparing **total message count** to detect when a new response arrived:

**Before (broken):**
```python
old_count = len(old_messages)           # e.g. 10
# ... send message ...
if len(messages) > old_count:           # triggers at 11
    for msg in reversed(messages):
        if msg.get("role") != "user":
            return msg
    return messages[-1]                 # FALLBACK: returns user's own message!
```

The problem: OpenClaw adds the **user's message** to history immediately after `chat.send`. So the total count jumps from 10 → 11 *before* the agent has replied. The poll detects `11 > 10`, iterates reversed looking for a non-user message, but all "new" messages are user messages. The fallback `return messages[-1]` returns the **user's own message** as the "response."

On the *next* send, the snapshot captures the state where the previous agent reply IS now present, and the poll picks it up — hence "1 message late."

### Fix Applied
- **File:** `api/services/remote_jason.py`
  - Changed to count only **assistant messages** (role != "user") instead of total messages
  - Removed the dangerous fallback that could return user messages

**After (fixed):**
```python
old_assistant_count = sum(1 for m in old_messages if m.get("role") != "user")
# ... send message ...
new_assistant_count = sum(1 for m in messages if m.get("role") != "user")
if new_assistant_count > old_assistant_count:
    for msg in reversed(messages):
        if msg.get("role") != "user":
            return msg
```

### Verification
```bash
# Message 1
curl -s -X POST http://localhost:8000/api/remote/send \
  -H 'Content-Type: application/json' \
  -d '{"content":"What is 2+2? Reply with just the number."}'
# Returns: {"content":"...4","model":"x-ai/grok-code-fast-1"} ✓ correct

# Message 2 (immediately after)
curl -s -X POST http://localhost:8000/api/remote/send \
  -H 'Content-Type: application/json' \
  -d '{"content":"What color is the sky? One word only."}'
# Returns: {"content":"blue","model":"x-ai/grok-code-fast-1"} ✓ correct, not stale
```

---

## Files Changed

| File | Change |
|------|--------|
| `api/services/remote_jason.py` | Fixed `chat_send` params, added `_poll_for_response`, fixed poll to count assistant msgs only |
| `api/routers/remote.py` | Simplified `send_to_remote` to use new `chat_send` return |
| `api/routers/chat.py` | Added `GET /api/chat/status` endpoint |
| `ui/src/api.ts` | Added `ChatStatus` type and `fetchChatStatus` function |
| `ui/src/components/Chat.tsx` | Added status check, warning banners, improved empty states |

---

## Test Results

- **86/86 automated tests pass**
- **UI build clean** (vite build succeeds)
- **Remote send verified** via curl — responses are correct and immediate (no lag)
- **1-message-late bug confirmed fixed** — consecutive sends return correct responses
- **Local status endpoint verified** — correctly reports API key not configured
- **Chat UI** shows proactive warning banners for both modes
