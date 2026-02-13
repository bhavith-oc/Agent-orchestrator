# Feature: @jason Mention Orchestration in Remote Chat

**Date:** 2026-02-09  
**Status:** Implemented & Verified

---

## Overview

When using the **Remote** mode in the Agents Hub (Chat page), messages are now routed based on `@jason` mentions:

- **`@jason <task>`** — Forwarded to the remote OpenClaw Jason. Creates a Mission card in Mission Control, spawns sub-agent records in Agent Pool, and returns Jason's plan immediately. A background monitor tracks completion and updates statuses.
- **No `@jason`** — Treated as team chat. Not forwarded to Jason. Returns a system hint to tag `@jason`.

---

## Architecture

```
User types "@jason build a login page"
        │
        ▼
POST /api/remote/send
        │
        ├── is_jason_mention() → true
        │       │
        │       ▼
        │   handle_jason_mention()
        │       │
        │       ├── 1. Create Mission in local DB (status: Active)
        │       │      → Appears in Mission Control board
        │       │
        │       ├── 2. Send task to remote OpenClaw via chat_send()
        │       │      → Returns Jason's first LLM response (plan)
        │       │
        │       ├── 3. Parse response for sub-tasks
        │       │      → Create sub-Mission cards + Agent records
        │       │      → Appear in Mission Control + Agent Pool
        │       │
        │       ├── 4. Return response to user immediately
        │       │
        │       └── 5. Background: _monitor_remote_completion()
        │              → Polls history until Jason finishes
        │              → Marks missions/agents as Completed
        │
        └── is_jason_mention() → false
                │
                └── Return "team chat" hint message
```

---

## Files Created

### `api/services/remote_orchestrator.py`

The core orchestration service. Key functions:

| Function | Purpose |
|----------|---------|
| `is_jason_mention(msg)` | Regex check for `@jason` in message (case-insensitive) |
| `strip_jason_mention(msg)` | Remove `@jason` prefix, return clean task text |
| `_is_known_agent(name)` | Check if a name matches the `KNOWN_AGENT_ROLES` whitelist (Researcher, QA, Planner, etc.) |
| `extract_worker_agents(text)` | Extract actual sub-agents from Jason's response using whitelist + 3 strategies (see below) |
| `extract_plan_steps(text)` | Extract numbered plan steps for `plan_json` storage (not used as sub-agents) |
| `normalize_openclaw_content(content)` | Convert OpenClaw `[{type:"text", text:"..."}]` arrays to plain text |
| `get_or_create_jason(db)` | Ensure Jason master agent exists in DB |
| `handle_jason_mention(msg, session_key)` | Main entry: create mission → send to remote → parse workers → return response → start background monitor |
| `_create_subtask_records(...)` | Create sub-Mission + sub-Agent records from extracted worker agents (with proper names like "Researcher", not "Agent-XXXX") |
| `_monitor_remote_completion(...)` | Background task: poll remote history until Jason finishes, then mark everything Completed |

---

## Files Modified

### `api/routers/remote.py` — `/send` endpoint

The `POST /api/remote/send` endpoint now routes through the orchestrator:

```python
if is_jason_mention(req.content):
    result = await handle_jason_mention(req.content, req.session_key)
    return result

# No @jason → team chat
return {"role": "agent", "name": "System", "content": "💬 Message sent to team chat..."}
```

### `api/services/remote_jason.py` — Improved polling

- Added `_count_llm_messages()` — counts only messages with `model` set + non-empty content (excludes tool outputs, empty messages)
- Added `_has_content()` — checks if a message has non-empty text
- Updated `_poll_for_response()` — returns the **first** new LLM response immediately instead of waiting for stabilization. This is critical because the remote Jason spawns sub-sessions that can take minutes.

### `ui/src/components/Chat.tsx` — @jason UI hints

- **Input placeholder** in remote mode: `"Type @jason to assign a task, or chat with the team..."`
- **@jason detection** — input border turns emerald green when `@jason` is typed
- **Footer text** — dynamically shows:
  - `"🎯 @jason detected — this message will be sent as a task..."` when @jason is present
  - `"💬 Team chat — messages without @jason are not forwarded to Jason."` otherwise
- **Empty state** — shows example: `@jason build a login page with email and password`
- **System messages** — styled with gray avatar/label (distinct from Jason's emerald)

### `ui/src/context/MissionContext.tsx` — Auto-refresh

Added 5-second polling interval so new missions created by the orchestrator appear in Mission Control in real-time.

---

## How It Works End-to-End

### 1. User sends `@jason` message
```
@jason what are 3 quick wins to improve a dashboard UI?
```

### 2. Backend creates Mission (appears in Mission Control as "Active")
```json
{
  "id": "3d9ff54e",
  "title": "what are 3 quick wins to improve a dashboard UI?",
  "status": "Active",
  "assigned_agent_id": "97bfde81"  // Jason
}
```

### 3. Task sent to remote OpenClaw Jason
Jason responds with his plan (first LLM response returned immediately to user).

### 4. Worker agents extracted and created
From Jason's response, actual sub-agents are identified using a whitelist approach:
- **Known roles** (Researcher, QA, Verifier, Planner, Coder, etc.) are matched via `KNOWN_AGENT_ROLES`
- **Sub-Mission cards** created in Mission Control (children of parent mission) with titles like "Researcher: core research/summarize"
- **Sub-Agent records** created in Agent Pool with proper names (e.g. "Researcher", not "Agent-XXXX")
- **Plan steps** (numbered items 1-8) stored in `plan_json` on the parent mission, NOT as sub-agents

### 5. Background monitor tracks completion
- Polls remote history every 5s
- When no new LLM messages for 2 consecutive polls → marks everything Completed
- Jason status returns to "Awaiting commands"

### 6. User sends non-@jason message
```
hey team, how's everyone doing?
```
Returns:
```
💬 Message sent to team chat. Tag @jason to assign a task.
Example: @jason build a login page with email and password
```

---

## Polling Strategy (remote_jason.py)

The remote OpenClaw Jason emits many message types during orchestration:

| Message Type | `model` field | `content` | Example |
|-------------|---------------|-----------|---------|
| Tool output | `null` | JSON | `{"status":"error","tool":"exec",...}` |
| Session creation | `null` | JSON | `{"sessionKey":"agent:main:subagent:..."}` |
| Empty LLM turn | set | empty | (intermediate thinking) |
| **Final LLM response** | **set** | **non-empty text** | **Jason's plan/summary** |

We only count and return messages where **both** `model` is set AND content is non-empty text. This filters out all intermediate noise.

---

## Test Results

- **86/86 automated tests pass**
- **UI build clean** (vite build succeeds)
- **@jason flow verified:**
  - Mission created in DB with status Active → Completed
  - Sub-agents spawned and visible in Agent Pool
  - Sub-mission cards created in Mission Control
  - Background monitor marks everything Completed after Jason finishes
  - Response returned to user in ~10s (not 120s timeout)
- **Non-@jason flow verified:** Returns team chat hint, not forwarded to Jason
- **Backend logs confirm full lifecycle:**
  ```
  Created mission 3d9ff54e: what are 3 quick wins...
  chat.send accepted: {runId: ..., status: started}
  Created 5 sub-tasks for mission 3d9ff54e
  Mission 3d9ff54e monitoring complete — marked as Completed
  ```

---

## Helper Code

### Worker agent extraction (`remote_orchestrator.py`)

Uses a **whitelist approach** with 3 strategies to avoid false positives:

```python
KNOWN_AGENT_ROLES = {
    'researcher', 'qa', 'verifier', 'planner', 'coder', 'designer',
    'tester', 'reviewer', 'writer', 'analyst', 'architect', 'debugger',
    'documenter', 'editor', 'summarizer', 'validator', 'checker',
    'qa/verifier', 'code reviewer',
}
```

**Strategy 1:** Match `Launched/Spawn <Name> session/sub-agent` patterns via `LAUNCHED_RE`
**Strategy 2:** Match known role names with parenthetical descriptions via `AGENT_WITH_ROLE_RE` (e.g. `Researcher (core research)`)
**Strategy 3:** Scan `Worker set:` lines for known roles (handles `1 Researcher` number prefix format)

### Agent Pool filtering (`Agents.tsx`)

```typescript
// Show master (Jason) always, active/busy sub-agents by default
const activeAgents = agents.filter(a =>
    a.type === 'master' || a.status === 'active' || a.status === 'busy')
const completedAgents = agents.filter(a =>
    a.type !== 'master' && (a.status === 'completed' || a.status === 'failed' || a.status === 'offline'))
const displayAgents = showCompleted ? agents : activeAgents
```

Toggle button appears when completed agents exist, showing count: `"2 active · 12 completed"`.

### LLM message counting (`remote_jason.py`)

```python
@staticmethod
def _count_llm_messages(messages: list[dict]) -> int:
    """Count messages with model set + non-empty content."""
    count = 0
    for m in messages:
        if m.get("role") == "user": continue
        if not m.get("model"): continue
        # ... check content is non-empty ...
        if text.strip(): count += 1
    return count
```

---

## Changelog (Feb 9, 2026 — Refinement Pass)

### Bug: Over-extraction of sub-agents
- **Problem:** Original `extract_subtasks_from_response()` used generic regexes (`TASK_LIST_RE`, `BULLET_RE`) that captured ALL numbered plan steps as sub-agents, creating 6-8 fake agents per task.
- **Fix:** Replaced with `extract_worker_agents()` using a whitelist of known agent roles (`KNOWN_AGENT_ROLES`). Only recognizes actual sub-agent names like Researcher, QA, Verifier, Planner.
- **Result:** Correctly extracts 1-2 real sub-agents per task instead of 6-8 noise entries.

### Bug: Agent Pool showing all agents including completed
- **Problem:** `Agents.tsx` displayed all agents regardless of status, cluttering the pool with completed/offline agents from previous runs.
- **Fix:** Added filtering to show only active/busy agents + Jason master by default. Added "Show All" toggle button with count summary.
- **Result:** Clean Agent Pool showing only currently relevant agents.

### Improvement: Sub-agent naming
- **Before:** Agents named `Agent-XXXX` (random ID prefix)
- **After:** Agents named with their actual role (e.g. "Researcher", "QA") as assigned by Jason
- **Sub-mission titles:** `"Researcher: core research/summarize"` instead of `"Researcher: Researcher"`
