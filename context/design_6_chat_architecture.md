# Design Document 6 — Chat Architecture

**Date:** 2026-02-09  
**Phase:** Fix Agent Hub chat + design proper chat flow  
**Status:** 🔧 In progress

---

## Problem Statement

When a user messages Jason in the Agent Hub chat, they get:
```
I encountered an error while processing your request: [Errno 2] No such file or directory: ''
```

**Root cause:** `jason.py:94` calls `git_manager.get_file_tree()` which calls `os.listdir(settings.REPO_PATH)`. Since `REPO_PATH=""` in `.env`, this raises `FileNotFoundError`. The error is caught at line 193 and returned as the user-visible message.

**Deeper issue:** The current `handle_user_message()` always assumes orchestrator mode (file tree → task planning → sub-agent spawning). There's no conversational fallback.

---

## Architecture: Two Chat Modes

### Mode 1: Conversational Chat (default)

**When:** `REPO_PATH` is empty OR user is just chatting (no code task)

**Flow:**
```
User → "Hello Jason, what can you do?"
  → POST /api/chat/send {role: "user", content: "..."}
  → jason_orchestrator.handle_user_message()
    → Load last N messages from DB for context
    → Send to LLM with system prompt + chat history
    → Return Jason's response
  → Save both messages to DB (ChatMessage)
  → Return response to UI
```

**Key features:**
- Multi-turn conversation with history from DB
- No file tree, no task planning, no sub-agents
- Works with just an OpenRouter API key
- Jason's system prompt is adapted for conversational mode

### Mode 2: Orchestrator Chat (when repo is configured)

**When:** `REPO_PATH` is set AND `OPENROUTER_API_KEY` is valid AND user's message looks like a code task

**Flow:**
```
User → "Refactor the auth module to use OAuth2"
  → POST /api/chat/send {role: "user", content: "..."}
  → jason_orchestrator.handle_user_message()
    → Get file tree from REPO_PATH
    → Create task plan via LLM
    → Create parent Mission in DB
    → For each task:
      → Create sub-Mission in DB
      → Spawn sub-Agent (Agent record in DB)
      → Create agent ChatSession in DB
      → Create discussion file: .agent/discussions/mission-{id}/agent-{name}.md
      → Execute sub-agent (LLM call → apply changes → git commit)
    → Monitor until all complete
    → Merge branches, write summary
    → Post completion message to user's chat session
```

---

## Storage Architecture

### Database (SQLite) — Source of Truth for UI

Already exists. No schema changes needed.

| Table | Purpose |
|---|---|
| `ChatSession` | Groups messages. `type="user"` for user↔Jason, `type="agent"` for Jason↔sub-agent |
| `ChatMessage` | Individual messages. `role` = user/agent/system. `sender_name` identifies who. |

**The UI reads from the database.** Every message displayed in Agent Hub comes from `ChatMessage`.

### Discussion Files (Markdown) — Audit Trail for Orchestrator Mode

New. Written alongside DB storage when sub-agents execute missions.

```
.agent/
  discussions/
    mission-{id}/
      overview.md           # Created by Jason when planning
      agent-{name}.md       # Each sub-agent's work log
      summary.md            # Created when mission completes
```

**Purpose:**
- Human-readable audit trail of agent reasoning
- Agents can read each other's discussion files for cross-context
- Persists even if DB is reset
- Can be committed to git as documentation

**Format of `overview.md`:**
```markdown
# Mission: {title}
**Created:** {timestamp}
**Requested by:** User
**Status:** Active

## Original Request
{user_message}

## Plan
{plan_summary}

## Tasks
- [ ] {task_1_title} — assigned to {agent_name}
- [ ] {task_2_title} — assigned to {agent_name}
```

**Format of `agent-{name}.md`:**
```markdown
# Agent: {name}
**Task:** {task_title}
**Model:** {model}
**Branch:** {git_branch}
**Started:** {timestamp}

## Task Description
{description}

## Files in Scope
- {file_1}
- {file_2}

## Work Log

### Step 1: Analysis
{agent's analysis from LLM response}

### Step 2: Changes Applied
- Modified: {file_path}
- Created: {file_path}

### Result
{summary from agent's JSON response}

**Status:** Completed | Failed
**Completed:** {timestamp}
```

**Format of `summary.md`:**
```markdown
# Mission Summary: {title}
**Completed:** {timestamp}
**Duration:** {duration}

## Results
- ✓ {task_1}: merged successfully
- ✓ {task_2}: merged successfully

## Changes
{git diff summary}
```

---

## Implementation Changes

### 1. `api/services/jason.py` — Rewrite `handle_user_message`

**Before:** Always tries file_tree → task_plan → spawn agents  
**After:** Detects mode and branches:

```python
async def handle_user_message(self, db, session_id, user_message):
    jason = await self.ensure_jason_exists(db)
    
    # Check if OpenRouter is configured
    if not settings.OPENROUTER_API_KEY or settings.OPENROUTER_API_KEY == "your-openrouter-api-key-here":
        return "⚠️ OpenRouter API key not configured. Set OPENROUTER_API_KEY in api/.env"
    
    # Load chat history for context
    history = await self._load_chat_history(db, session_id, limit=20)
    
    if not settings.REPO_PATH:
        # Conversational mode
        return await self._conversational_response(user_message, history)
    else:
        # Orchestrator mode (existing logic, with file_tree)
        ...
```

**New method `_conversational_response`:**
- Builds messages array: system prompt + recent history + current message
- Calls LLM directly
- Returns response string

**New method `_load_chat_history`:**
- Queries ChatMessage for the session, ordered by created_at
- Returns last N messages as `[{role, content}]` for LLM context

### 2. `api/services/discussion_writer.py` — NEW

Service for writing discussion markdown files.

### 3. `api/services/sub_agent.py` — Wire in discussion writer

After each sub-agent LLM call, append to the agent's discussion file.

### 4. `api/services/jason.py` — Wire in discussion writer for missions

When creating a mission plan, write `overview.md`. When finalizing, write `summary.md`.

---

## Why Both DB and Markdown?

| Concern | Database | Markdown Files |
|---|---|---|
| UI display | ✅ Primary source | ❌ Not used by UI |
| Query/filter | ✅ SQL queries | ❌ File search only |
| Agent cross-reference | ❌ Agents don't query DB | ✅ Agents read files |
| Human audit | ⚠️ Requires DB viewer | ✅ Open in any editor |
| Git tracking | ❌ Binary DB file | ✅ Diffable, committable |
| Persistence | ⚠️ DB can be reset | ✅ Files persist |
| Performance | ✅ Fast indexed queries | ⚠️ File I/O |

**Bottom line:** DB for the app, markdown for humans and agents.

---

## Error Handling

| Scenario | Behavior |
|---|---|
| `OPENROUTER_API_KEY` not set | Return helpful config message |
| `OPENROUTER_API_KEY` invalid | LLM call fails → return error message |
| `REPO_PATH` empty | Use conversational mode (no task planning) |
| `REPO_PATH` invalid | Return error, suggest fixing .env |
| LLM timeout | Return timeout message |
| Sub-agent fails | Retry up to MAX_RETRIES, then report failure |
