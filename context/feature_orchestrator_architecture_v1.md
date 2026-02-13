# Feature: Jason Master → Sub-Agent Container Orchestration (Phase 1)

**Date**: February 13, 2026  
**Status**: Implemented  
**Session**: Architecture overhaul — Phase 1 coding task orchestration

---

## Overview

This is the first major architecture overhaul of Aether Orchestrator. The system now supports a **master-agent orchestration pattern** where:

1. **Jason** is the master OpenClaw container (deployed via one-click deploy)
2. Jason receives complex coding tasks and **decomposes them into subtasks**
3. Each subtask is routed to a **domain-specific expert agent** (Python, React, Database, DevOps, etc.)
4. Results are collected and **synthesized by Jason** into a final integrated response

---

## Architecture

### Before (v0.5.0)
```
User → Chat UI → Backend API → Single OpenClaw Container (chat only)
```

### After (v1.0.0 — Phase 1)
```
User → API → Orchestrator Service
                ├── Jason Master (LLM) → Task Plan (JSON)
                ├── Expert Agent 1 (LLM) → Subtask Result
                ├── Expert Agent 2 (LLM) → Subtask Result
                ├── Expert Agent N (LLM) → Subtask Result
                └── Jason Master (LLM) → Synthesized Final Result
```

### Data Flow

```
1. User submits coding task via POST /api/orchestrate/task
2. Orchestrator sends task to Jason (LLM) with planning system prompt
3. Jason returns JSON plan: { subtasks: [{ id, description, agent_type, depends_on }] }
4. Orchestrator creates Subtask objects, respects dependency ordering
5. For each ready subtask (all deps met), orchestrator:
   a. Loads the agent template (system prompt) for the required agent_type
   b. Builds context from completed dependency results
   c. Sends subtask to LLM with expert system prompt
   d. Collects result
6. When all subtasks complete, orchestrator sends results to Jason for synthesis
7. Jason produces final integrated response
8. Task status updated to "completed" with final_result
```

---

## New Files

### `api/services/agent_templates.py`
**Purpose**: Pre-defined configurations for domain-specific expert agents.

Each template contains:
- `name`: Human-readable name
- `description`: What the agent specializes in
- `system_prompt`: The system prompt used when executing subtasks
- `tags`: Keywords for heuristic matching

**Available Templates**:

| Type | Name | Specialization |
|------|------|----------------|
| `python-backend` | Python Backend Expert | FastAPI, Django, SQLAlchemy, async |
| `react-frontend` | React Frontend Expert | React 19, TypeScript, Tailwind, Vite |
| `database-expert` | Database Expert | SQL, NoSQL, schema design, migrations |
| `devops-expert` | DevOps Expert | Docker, K8s, CI/CD, Terraform |
| `fullstack` | Full-Stack Developer | General-purpose across all layers |
| `testing-expert` | Testing & QA Expert | pytest, Jest, Playwright, TDD |

**Key Functions**:
- `get_template(agent_type)` → Returns template dict or None
- `list_templates()` → Returns all templates with metadata
- `match_template(task_description)` → Keyword-based fallback matching

### `api/services/orchestrator.py`
**Purpose**: Core orchestration logic — the brain of the system.

**Classes**:
- `TaskStatus` — Enum: pending, planning, executing, synthesizing, completed, failed
- `SubtaskStatus` — Enum: pending, creating_agent, executing, completed, failed
- `Subtask` — Data class for individual subtasks with results and timing
- `OrchestratorTask` — Data class for the full task with subtasks, logs, plan
- `Orchestrator` — Main service class (singleton)

**Orchestration Pipeline** (`_orchestrate` method):
1. **Planning Phase**: `_get_task_plan()` — Sends task to Jason LLM with planning prompt, gets JSON plan
2. **Execution Phase**: `_execute_subtasks()` — Respects dependency ordering, parallel execution of independent subtasks
3. **Synthesis Phase**: `_synthesize_results()` — Sends all results to Jason LLM for integration

**Phase 1 vs Phase 2 Execution**:
- Phase 1 (current): Uses `_execute_single_subtask()` — calls LLM directly with expert system prompt
- Phase 2 (future): Uses `_execute_subtask_via_container()` — creates real OpenClaw containers per agent

**Key Design Decisions**:
- Planning uses `llm_client.chat_json()` for structured JSON output
- Subtasks with no unmet dependencies execute in parallel via `asyncio.gather()`
- Failed subtasks don't block other independent subtasks
- Synthesis has a fallback (concatenation) if LLM fails
- All tasks run in background via `asyncio.create_task()`

### `api/routers/orchestrate.py`
**Purpose**: REST API endpoints for orchestration.

**Endpoints**:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/orchestrate/task` | Submit a coding task for orchestration |
| `GET` | `/api/orchestrate/task/{id}` | Get task status (poll for completion) |
| `GET` | `/api/orchestrate/tasks` | List all orchestrated tasks |
| `GET` | `/api/orchestrate/agents` | List available expert agent templates |

**Request: Submit Task**:
```json
{
    "description": "Build a REST API for user management with CRUD endpoints",
    "master_deployment_id": "abc123"
}
```

**Response: Task Status**:
```json
{
    "id": "uuid",
    "description": "...",
    "status": "executing",
    "subtasks": [
        {
            "id": "subtask-1",
            "description": "Create SQLAlchemy models...",
            "agent_type": "database-expert",
            "status": "completed",
            "result": "...",
            "depends_on": []
        },
        {
            "id": "subtask-2",
            "description": "Create FastAPI endpoints...",
            "agent_type": "python-backend",
            "status": "executing",
            "depends_on": ["subtask-1"]
        }
    ],
    "plan": { "analysis": "...", "subtasks": [...] },
    "final_result": null,
    "logs": ["[12:00:00] [INFO] Task created...", "..."],
    "created_at": "2026-02-13T...",
    "completed_at": null
}
```

---

## UI Changes

### Removed
- **System Metrics page** — Removed from sidebar nav, header title mapping, and content routes
- **System Load widget** — Removed from sidebar bottom
- **"Neural Link" label** — Replaced with "Agent Hub" in header
- **Container name display** — Simplified in Agent Hub sidebar cards (shows "Connected" / "Running" instead of session name + port)
- **ComingSoon component import** — No longer needed

### Added
- **Agent deletion** — Trash icon on hover for non-master agents in Agents Pool page
  - Calls `DELETE /api/agents/{id}` via new `deleteAgent()` API function
  - Confirmation dialog before deletion
  - Auto-refreshes agent list after deletion

### Fixed
- **Vite allowedHosts** — Set `server.allowedHosts: true` in `vite.config.js` to allow VPS domains like `virtualgpt.org`

---

## Frontend API Additions (`ui/src/api.ts`)

### New Types
- `OrchestratorSubtask` — Subtask with status, result, timing
- `OrchestratorTask` — Full task with subtasks, plan, logs
- `AgentTemplate` — Expert agent type metadata

### New Functions
- `submitOrchestratorTask(description, masterDeploymentId)` → POST /api/orchestrate/task
- `fetchOrchestratorTask(taskId)` → GET /api/orchestrate/task/{id}
- `fetchOrchestratorTasks()` → GET /api/orchestrate/tasks
- `fetchAgentTemplates()` → GET /api/orchestrate/agents
- `deleteAgent(agentId)` → DELETE /api/agents/{id}

---

## Backend Changes

### `api/main.py`
- Added `orchestrate` router import and registration
- Added orchestrator cleanup on shutdown (`orch.cleanup_connections()`)

### `api/main.py` — CORS
- Already configurable via `CORS_ORIGINS` env var (from previous session)

---

## Commands & Verification

### Import Verification
```bash
cd api && source venv/bin/activate
python3 -c "
from routers import orchestrate
from services.orchestrator import orchestrator
from services.agent_templates import list_templates
print('All imports OK')
print(f'{len(list_templates())} agent templates loaded')
for t in list_templates():
    print(f'  - {t[\"type\"]}: {t[\"name\"]}')
"
```

**Output**:
```
All imports OK
6 agent templates loaded
  - python-backend: Python Backend Expert
  - react-frontend: React Frontend Expert
  - database-expert: Database Expert
  - devops-expert: DevOps Expert
  - fullstack: Full-Stack Developer
  - testing-expert: Testing & QA Expert
```

### Frontend Build
```bash
cd ui && npx vite build
```
**Output**: `✓ built in 9.31s` (success)

### Testing the Orchestration API
```bash
# List available agent templates
curl http://localhost:8000/api/orchestrate/agents

# Submit a coding task
curl -X POST http://localhost:8000/api/orchestrate/task \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Build a REST API for user management with CRUD endpoints, database models, and unit tests",
    "master_deployment_id": "your-deployment-id"
  }'

# Poll task status
curl http://localhost:8000/api/orchestrate/task/{task_id}

# List all tasks
curl http://localhost:8000/api/orchestrate/tasks
```

---

## Phase 2 Roadmap (Future)

Phase 1 uses LLM calls directly with expert system prompts. Phase 2 will:

1. **Container-based execution** — Each expert agent runs in its own OpenClaw container
2. **Persistent agent pool** — Keep frequently-used expert containers running
3. **Container auto-scaling** — Create/destroy containers based on demand
4. **Shared workspace** — Git worktrees for code sharing between agents
5. **Real-time streaming** — WebSocket updates for task progress
6. **UI integration** — Mission Board shows orchestrated tasks with subtask progress

---

## Files Modified

| File | Change |
|------|--------|
| `api/services/agent_templates.py` | **NEW** — Expert agent template definitions |
| `api/services/orchestrator.py` | **NEW** — Core orchestration service |
| `api/routers/orchestrate.py` | **NEW** — Orchestration API endpoints |
| `api/main.py` | Added orchestrate router + shutdown cleanup |
| `ui/src/App.tsx` | Removed System Metrics, Neural Link, System Load widget |
| `ui/src/components/Chat.tsx` | Removed "Neural Links" heading, simplified container info |
| `ui/src/components/Agents.tsx` | Added delete button for non-master agents |
| `ui/src/api.ts` | Added orchestration + deleteAgent API functions |
| `ui/vite.config.js` | Added `server.allowedHosts: true` for VPS |
