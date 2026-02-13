# Bug Fix — Jason Chat "No such file or directory" Error

**Date:** 2026-02-09  
**Severity:** 🔴 Critical — chat completely broken  
**Status:** ✅ Fixed

---

## Symptom

When sending any message to Jason in the Agent Hub chat, the user receives:
```
I encountered an error while processing your request: [Errno 2] No such file or directory: ''
```

---

## Root Cause

**File:** `api/services/jason.py`, line 94  
**Code:** `file_tree = await git_manager.get_file_tree()`

This calls `git_manager._walk_tree(self.repo_path, ...)` which calls `os.listdir(path)` where `path = settings.REPO_PATH`.

**Problem:** `REPO_PATH=""` in `.env` (empty string). `os.listdir("")` raises `FileNotFoundError: [Errno 2] No such file or directory: ''`.

The exception is caught at line 193 and returned as the user-visible error message:
```python
except Exception as e:
    return f"I encountered an error while processing your request: {str(e)}"
```

**Why REPO_PATH is empty:** The `.env` file has `REPO_PATH=` with no value. This is the default — the user hasn't pointed Jason at a specific git repository yet. But the code assumed REPO_PATH would always be set.

---

## Fix Applied

Rewrote `handle_user_message()` in `api/services/jason.py` to support **two modes**:

### 1. API Key Guard (new)
```python
api_key = settings.OPENROUTER_API_KEY
if not api_key or api_key == "your-openrouter-api-key-here":
    return "⚠️ OpenRouter API key not configured..."
```
Returns a helpful configuration message instead of crashing when the API key is missing.

### 2. Conversational Mode (new — when `REPO_PATH` is empty)
```python
if not settings.REPO_PATH:
    response = await self._conversational_response(user_message, history)
    return response
```
Jason chats directly using the LLM with multi-turn history from the database. No file tree scanning, no task planning, no sub-agent spawning.

### 3. Orchestrator Mode (existing — when `REPO_PATH` is set)
The original pipeline (file tree → task plan → sub-agents) is preserved but only runs when `REPO_PATH` is configured.

---

## New Methods Added to `JasonOrchestrator`

### `_load_chat_history(db, session_id, limit=20)`
- Queries `ChatMessage` table for the session
- Returns last N messages as `[{role, content}]`
- Maps `role="agent"` → `role="assistant"` for LLM compatibility
- Provides multi-turn conversational memory

### `_conversational_response(user_message, history)`
- Builds LLM messages: system prompt + chat history + current message
- Calls OpenRouter LLM directly
- Returns Jason's response string

### Updated `_direct_response(user_message, file_tree, history)`
- Now accepts `history` parameter for multi-turn context in orchestrator mode too

---

## Additional Changes

### New Service: `api/services/discussion_writer.py`
Writes markdown audit trail files for orchestrator-mode missions:
- `write_mission_overview()` — creates `.agent/discussions/mission-{id}/overview.md`
- `write_agent_log_header()` — creates agent work log header
- `append_agent_log()` — appends reasoning/changes to agent log
- `write_mission_summary()` — creates completion summary

### Wired into `api/services/sub_agent.py`
- Writes discussion header when sub-agent starts
- Logs LLM response to discussion file
- Logs completion status and commit hash

### Wired into `api/services/jason.py`
- Writes `overview.md` when creating a mission plan
- Writes `summary.md` when finalizing a mission

---

## Files Changed

| File | Change |
|---|---|
| `api/services/jason.py` | Added API key guard, conversational mode, chat history loading, discussion writer integration |
| `api/services/sub_agent.py` | Added discussion writer import and logging at start/response/completion |
| `api/services/discussion_writer.py` | **NEW** — markdown audit trail service |
| `api/tests/test_chat_architecture.py` | **NEW** — 12 tests for conversational mode, discussion writer, history loading |

---

## Tests Added

| Test | What it verifies |
|---|---|
| `test_missing_api_key_returns_config_message` | Placeholder API key → helpful message |
| `test_empty_api_key_returns_config_message` | Empty API key → helpful message |
| `test_conversational_mode_calls_llm` | Valid key + empty REPO_PATH → LLM called directly |
| `test_conversational_mode_includes_history` | Multi-turn history passed to LLM |
| `test_write_mission_overview` | Creates overview.md with correct content |
| `test_write_agent_log_header` | Creates agent log with task/model/scope |
| `test_append_agent_log` | Appends sections to agent log |
| `test_append_agent_log_creates_file_if_missing` | Auto-creates file on first append |
| `test_write_mission_summary` | Creates summary with merge results + duration |
| `test_write_mission_summary_no_merges` | Handles empty merge results |
| `test_load_empty_history` | Returns empty list for nonexistent session |
| `test_load_history_maps_roles` | Maps agent→assistant for LLM compatibility |

**Full suite: 77/77 tests passing**

---

## Verification

```bash
# Test: send message with placeholder API key
curl -s -X POST http://localhost:8000/api/chat/send \
  -H "Content-Type: application/json" \
  -d '{"role":"user","content":"Hello Jason"}' | python3 -m json.tool

# Result: Returns helpful config message instead of crashing
{
    "role": "agent",
    "name": "Jason",
    "content": "⚠️ **OpenRouter API key not configured.**\n\nSet `OPENROUTER_API_KEY`..."
}
```

---

## How to Enable Full Chat

1. Get an API key from [openrouter.ai](https://openrouter.ai)
2. Set `OPENROUTER_API_KEY=sk-or-v1-...` in `api/.env`
3. Restart the backend
4. Jason will respond using `openai/gpt-4o` in conversational mode
5. To enable orchestrator mode (task planning + sub-agents), also set `REPO_PATH=/path/to/your/repo`
