# Bug Fix: Mission Board Flow & Agent Pool Visibility

**Date:** 2026-02-09  
**Status:** Fixed & Verified

---

## Issues Reported

### Issue 1: Mission Board skipping Queue → going straight to Completed
- **Problem:** When a `@jason` query was received, the mission was created with `status="Active"` immediately, then the background monitor marked it `"Completed"` within seconds. The user expected:
  - **Mission Queue** — when query is received, waiting for Jason to respond
  - **Active Operations** — when sub-agents start working
  - **Mission Debrief** — when final response is received
- **Root cause:** `handle_jason_mention()` in `remote_orchestrator.py` created the parent mission with `status="Active"` instead of `"Queue"`.

### Issue 2: Sub-agents not appearing in Agent Pool or Chat sidebar
- **Problem:** When Jason spawned sub-agents via `sessions_spawn` tool calls, they were not detected by our extraction logic. The Chat sidebar (Neural Links) also showed ALL agents including completed/offline ones.
- **Root cause (extraction):** The extraction only looked for text patterns like "Worker session set: Researcher + QA" in the LLM response. But OpenClaw's actual sub-agent spawn happens via `sessions_spawn` tool outputs containing `childSessionKey` in the chat history — NOT in the LLM text.
- **Root cause (sidebar):** `Chat.tsx` rendered all agents from `fetchAgents()` without filtering by status.

---

## Fixes Applied

### Fix 1: Mission status flow (`api/services/remote_orchestrator.py`)

**Before:** Mission created as `"Active"` → background monitor marks `"Completed"`  
**After:** Mission created as `"Queue"` → moved to `"Active"` when sub-agents start → `"Completed"` when done

```
Queue (Mission Queue)     → User sent @jason query, waiting for response
Active (Active Operations) → Sub-agents created and working
Completed (Mission Debrief) → Background monitor detects completion
```

Changes:
- Line ~208: `status="Active"` → `status="Queue"`
- After `_create_subtask_records()` returns: move parent mission to `"Active"` with `started_at` timestamp
- Sub-missions still created as `"Active"` (agents are immediately working)

### Fix 2: Sub-agent detection from `sessions_spawn` tool outputs

Added `extract_spawned_sessions(messages)` function that scans chat history for:
```json
{
  "status": "accepted",
  "childSessionKey": "agent:main:subagent:b61a49ce-...",
  "runId": "32c6458c-..."
}
```

Updated `extract_worker_agents()` with new strategies:
1. **Strategy 0:** Detect `sessions_spawn` tool outputs from chat history (most reliable)
2. **Strategy 2 (new):** `DELEGATING_RE` — matches "Delegating to a researcher sub-agent"
3. **Strategy 5 (new):** Fallback — if spawns detected but no named agents from text, create generic "Researcher" agents

Also added baseline spawn tracking:
- Snapshot spawn count BEFORE sending message
- After response, only count NEW spawns (not old ones from previous requests)

### Fix 3: Chat sidebar Neural Links filtering (`ui/src/components/Chat.tsx`)

**Before:** All agents shown (including 20+ completed/offline)  
**After:** Only `active`/`busy` agents + master (Jason) shown

```typescript
agents.filter(a => a.type === 'master' || a.status === 'active' || a.status === 'busy')
```

---

## Files Modified

| File | Change |
|------|--------|
| `api/services/remote_orchestrator.py` | Mission flow Queue→Active→Completed; `extract_spawned_sessions()`; `DELEGATING_RE`; baseline spawn tracking |
| `ui/src/components/Chat.tsx` | Neural Links sidebar filtered to active/busy agents only |
| `ui/src/components/Agents.tsx` | Agent Pool filtered (done in previous session) |

---

## Test Results (Backend Logs)

```
15:10:37 — Created mission b4604db5 (Queue)
15:11:04 — New spawns since request: 1 (baseline was 8)
15:11:04 — Detected 1 sessions_spawn in chat history
15:11:04 — Created 1 worker agents: ['Researcher']
15:11:04 — Mission b4604db5 moved to Active Operations
15:11:15 — Mission b4604db5 monitoring complete — marked as Completed
```

Full lifecycle: **Queue → Active → Completed** in ~37 seconds.

---

## Key Insight

OpenClaw's sub-agent spawning happens via `sessions_spawn` tool calls that produce `childSessionKey` in the chat history messages — NOT via text patterns in the LLM response. The LLM text may say "Delegating to a researcher sub-agent" but the actual spawn signal is the JSON tool output. Both signals are now detected.
