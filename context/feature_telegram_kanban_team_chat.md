# Feature: Telegram → Kanban → Team Chat Integration

**Date:** 2025-02-13  
**Status:** Implemented (Phase 1)

---

## Overview

Jason orchestrator now integrates with Telegram via the master OpenClaw container's WebSocket event stream. Telegram messages become Mission cards on the Kanban board, Jason decomposes tasks into subtasks executed by OpenClaw sub-agent containers, all progress is posted to a shared Team Chat per mission, and Jason reviews each sub-agent's output before approving.

## Architecture Flow

```
Telegram User → Master OpenClaw Container (Telegram enabled)
                    │ WebSocket event stream
                    ▼
              TelegramBridge (listens for chat events)
                    │
                    ├── Creates Mission card → Kanban "Queue"
                    ├── Creates Team Chat session
                    └── Starts Orchestration Pipeline
                          │
                          ├── Jason plans subtasks (LLM)
                          ├── For each subtask:
                          │     ├── Try container execution (primary)
                          │     └── Fallback to LLM execution
                          │     └── Post result to Team Chat
                          │     └── Jason reviews (approve/reject)
                          ├── Synthesize final result
                          ├── Update Kanban card → "Completed"
                          └── Send summary + UI link via Telegram
```

## Files Changed

### New Files (Backend)

| File | Purpose |
|------|---------|
| `api/services/team_chat.py` | Team chat service — shared chat per mission, WebSocket broadcast |
| `api/services/telegram_bridge.py` | Listens to master container WS events for Telegram messages |
| `api/routers/team_chat.py` | REST API: GET sessions, GET messages, POST send |
| `api/routers/telegram_bridge.py` | REST API: POST start, POST stop, GET status |

### New Files (Frontend)

| File | Purpose |
|------|---------|
| `ui/src/components/TeamChat.tsx` | Team Chat panel — mission list + message view + send |

### Modified Files (Backend)

| File | Changes |
|------|---------|
| `api/models/mission.py` | +3 columns: `source`, `source_message_id`, `review_status` |
| `api/models/agent.py` | +2 columns: `deployment_id`, `agent_template` |
| `api/schemas/mission.py` | Added new fields to Create/Update/Response schemas |
| `api/schemas/agent.py` | Added `deployment_id`, `agent_template` to AgentResponse |
| `api/config.py` | Added `MASTER_DEPLOYMENT_ID`, `UI_BASE_URL` settings |
| `api/main.py` | Registered team_chat + telegram_bridge routers, shutdown cleanup |
| `api/services/orchestrator.py` | Container-based execution (primary) + LLM fallback, team chat integration at every stage, Jason review loop (approve/reject), on_complete callback for Telegram replies, mission_id tracking |

### Modified Files (Frontend)

| File | Changes |
|------|---------|
| `ui/src/App.tsx` | Added Team Chat sidebar tab (MessagesSquare icon) |
| `ui/src/api.ts` | Added Mission source/review fields, team chat API functions, telegram bridge API functions, OrchestratorTask mission_id |
| `ui/src/components/Dashboard.tsx` | Telegram source badge, review status icons, Failed column (4-col grid) |
| `ui/src/context/MissionContext.tsx` | Added 5s polling for real-time kanban updates |

## Database Changes

No new tables. Additive columns only:

- **Mission**: `source` (default "manual"), `source_message_id` (nullable), `review_status` (nullable)
- **Agent**: `deployment_id` (nullable), `agent_template` (nullable)

**Action required**: Delete `aether.db` and restart backend to recreate schema.

## New API Endpoints

### Team Chat
- `GET /api/team-chat/sessions` — List all team chat sessions
- `GET /api/team-chat/{mission_id}/messages` — Get messages for a mission
- `POST /api/team-chat/{mission_id}/send` — Send a message (body: `{content, sender_name}`)

### Telegram Bridge
- `POST /api/telegram-bridge/start` — Start listening (body: `{deployment_id}`)
- `POST /api/telegram-bridge/stop` — Stop listening
- `GET /api/telegram-bridge/status` — Get bridge status

## Config Settings Added

| Setting | Default | Purpose |
|---------|---------|---------|
| `MASTER_DEPLOYMENT_ID` | `""` | Deployment ID of master OpenClaw container |
| `UI_BASE_URL` | `http://localhost:5173` | Frontend URL for Telegram links |

## How to Use

1. **Deploy master container** via Deploy Agent page with `TELEGRAM_BOT_TOKEN` and `TELEGRAM_USER_ID` configured
2. **Start Telegram Bridge**: `POST /api/telegram-bridge/start` with the deployment ID
3. **Send a Telegram message** to the bot — it creates a Mission card and starts orchestration
4. **Watch Team Chat** in the UI sidebar for real-time agent updates
5. **Kanban board** auto-updates as missions move through Queue → Active → Completed/Failed
6. **Telegram reply** is sent automatically with summary + UI link when task completes

## Orchestrator Execution Flow

1. **Planning**: Jason (LLM) decomposes task into subtasks with agent types
2. **Execution**: For each subtask:
   - Primary: container-based via `DeploymentChatManager` (sends to master container with expert prefix)
   - Fallback: direct LLM call with expert system prompt
3. **Review**: Jason reviews each sub-agent output via LLM (`approved` / `changes_requested`)
4. **Synthesis**: Jason synthesizes all results into final response
5. **Completion**: Updates Kanban card, posts to Team Chat, fires on_complete callback (Telegram reply)

## Dependencies

- **No new pip packages** — uses master container's built-in Telegram support
- **No new npm packages** — uses existing Lucide icons (MessagesSquare added)
- **Prerequisite**: Master OpenClaw container deployed with Telegram credentials
