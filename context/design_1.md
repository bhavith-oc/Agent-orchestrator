# Design Document 1 — Backend Foundation Build

**Date:** 2026-02-08  
**Phase:** Backend scaffolding — database, models, schemas, services, routers, main app  
**Status:** ✅ Server running, all endpoints verified

---

## Summary

This document covers the creation of the entire backend foundation for the Aether Orchestrator — 28 Python files that implement the Jason master agent architecture. The server starts, creates the SQLite database, seeds the Jason agent and admin user, and exposes all REST + WebSocket endpoints.

---

## Files Created (in order)

### 1. `api/requirements.txt`
- **Purpose:** Declares all Python dependencies for the backend
- **Why created:** Foundation — nothing runs without dependencies
- **Role:** Dependency management. Consumed by `pip install -r requirements.txt`
- **Importance:** 🔴 Critical — without this, no packages install
- **Key packages:**
  - `fastapi` — web framework
  - `uvicorn` — ASGI server
  - `sqlalchemy` + `aiosqlite` — async ORM + SQLite driver
  - `pydantic` + `pydantic-settings` — data validation + config
  - `python-jose` — JWT token creation/verification
  - `bcrypt` — password hashing (replaced `passlib` due to compatibility bug)
  - `httpx` — async HTTP client for OpenRouter API calls
  - `websockets` — WebSocket support
  - `psutil` — system metrics (CPU, memory, disk)
  - `pyyaml` — config file parsing

---

### 2. `api/config.py`
- **Purpose:** Centralized configuration using Pydantic Settings
- **Why created:** All services need access to env vars (API keys, DB URL, model names, etc.)
- **Role:** Single source of truth for all configuration. Reads from `.env` file automatically.
- **Importance:** 🔴 Critical — every other module imports `settings` from here
- **Key settings:**
  - `OPENROUTER_API_KEY` / `OPENROUTER_BASE_URL` — LLM provider
  - `JASON_MODEL` / `SUB_AGENT_MODEL` — which models Jason and sub-agents use
  - `REPO_PATH` / `WORKTREE_BASE_PATH` — git worktree locations
  - `SECRET_KEY` / `ALGORITHM` — JWT auth
  - `DATABASE_URL` — SQLite connection string

---

### 3. `api/.env`
- **Purpose:** Environment variable file with default/placeholder values
- **Why created:** `config.py` reads from this file. User sets their OpenRouter API key here.
- **Role:** Runtime configuration that stays out of version control
- **Importance:** 🟡 Medium — server runs with defaults, but LLM features need the API key set

---

### 4. `api/database.py`
- **Purpose:** SQLAlchemy async engine, session factory, and DB initialization
- **Why created:** All data persistence flows through this module
- **Role:** 
  - Creates the async engine connected to SQLite
  - Provides `async_session` factory for creating DB sessions
  - Provides `get_db` dependency for FastAPI route injection
  - `init_db()` creates all tables on startup
- **Importance:** 🔴 Critical — the data layer foundation. Every router and service depends on it.

---

### 5. `api/models/__init__.py`
- **Purpose:** Re-exports all ORM models from a single import
- **Why created:** Clean import pattern — `from models import User, Agent, Mission`
- **Role:** Module aggregator
- **Importance:** 🟢 Low — convenience only, but keeps imports clean

---

### 6. `api/models/user.py`
- **Purpose:** SQLAlchemy ORM model for the `users` table
- **Why created:** Authentication requires persistent user records
- **Role:** Defines `User` with fields: `id`, `username`, `password_hash`, `role`, `created_at`
- **Importance:** 🟡 Medium — needed for JWT auth. Default admin user seeded on startup.

---

### 7. `api/models/agent.py`
- **Purpose:** SQLAlchemy ORM model for the `agents` table
- **Why created:** Core entity — Jason and all sub-agents are stored here
- **Role:** Defines `Agent` with fields: `id`, `name`, `type` (master/sub), `status`, `parent_agent_id`, `model`, `system_prompt`, `worktree_path`, `git_branch`, `current_task`, `load`, `retry_count`, timestamps
- **Importance:** 🔴 Critical — this is the heart of the orchestrator. Every agent (Jason + sub-agents) is tracked here.

---

### 8. `api/models/mission.py`
- **Purpose:** SQLAlchemy ORM models for `missions` and `mission_dependencies` tables
- **Why created:** Missions are the work units — user requests decomposed into tasks
- **Role:** 
  - `Mission`: `id`, `title`, `description`, `status`, `priority`, `parent_mission_id` (for subtasks), `assigned_agent_id`, `files_scope`, `git_branch`, `plan_json`, timestamps
  - `MissionDependency`: tracks which missions depend on which (task ordering)
- **Importance:** 🔴 Critical — maps directly to the Kanban board in the UI

---

### 9. `api/models/chat.py`
- **Purpose:** SQLAlchemy ORM models for `chat_sessions` and `chat_messages` tables
- **Why created:** Chat is the primary user↔Jason interface
- **Role:**
  - `ChatSession`: `id`, `type` (user/agent), `agent_id`, `mission_id`, `created_at`
  - `ChatMessage`: `id`, `session_id`, `role`, `sender_name`, `content`, `files`, `created_at`
- **Importance:** 🔴 Critical — all communication flows through chat sessions

---

### 10. `api/schemas/__init__.py`
- **Purpose:** Re-exports all Pydantic schemas
- **Why created:** Clean import pattern for routers
- **Role:** Module aggregator
- **Importance:** 🟢 Low — convenience

---

### 11. `api/schemas/auth.py`
- **Purpose:** Pydantic request/response schemas for authentication
- **Why created:** FastAPI uses these for request validation and response serialization
- **Role:** `LoginRequest`, `RegisterRequest`, `TokenResponse`, `UserResponse`
- **Importance:** 🟡 Medium — defines the auth API contract

---

### 12. `api/schemas/agent.py`
- **Purpose:** Pydantic schemas for agent CRUD operations
- **Why created:** Validates agent creation, updates, and API responses
- **Role:** `AgentCreate`, `AgentUpdate`, `AgentResponse`, `AgentWithChildren`
- **Importance:** 🟡 Medium — defines the agents API contract

---

### 13. `api/schemas/mission.py`
- **Purpose:** Pydantic schemas for missions + the task plan structure
- **Why created:** Validates mission CRUD and defines the JSON structure Jason's planner outputs
- **Role:** `MissionCreate`, `MissionUpdate`, `MissionResponse`, `TaskPlan`, `TaskPlanItem`
- **Importance:** 🔴 Critical — `TaskPlan` / `TaskPlanItem` define how Jason decomposes work

---

### 14. `api/schemas/chat.py`
- **Purpose:** Pydantic schemas for chat sessions and messages
- **Why created:** Validates chat API requests/responses + backward compatibility with existing UI
- **Role:** `ChatSessionCreate`, `ChatSessionResponse`, `ChatMessageCreate`, `ChatMessageResponse`, `LegacyMessage`
- **Importance:** 🟡 Medium — `LegacyMessage` ensures existing UI works without changes initially

---

### 15. `api/services/__init__.py`
- **Purpose:** Empty init for the services package
- **Why created:** Makes `services/` a Python package
- **Role:** Package marker
- **Importance:** 🟢 Low — required by Python

---

### 16. `api/services/llm_client.py`
- **Purpose:** OpenRouter-based LLM client for all AI interactions
- **Why created:** Jason and sub-agents both need to call LLMs. This provides a unified interface.
- **Role:**
  - `chat()` — sends chat completion request to OpenRouter, returns text
  - `chat_json()` — same but parses response as JSON (used by task planner)
  - Handles auth headers, timeouts, markdown code fence stripping
- **Importance:** 🔴 Critical — the bridge between our system and AI models. Without this, no intelligence.
- **Key detail:** Uses OpenRouter's `/v1/chat/completions` endpoint (OpenAI-compatible format). Model names use OpenRouter format: `openai/gpt-4o`, `anthropic/claude-3.5-sonnet`, etc.

---

### 17. `api/services/git_manager.py`
- **Purpose:** Manages git worktrees for sub-agent isolation
- **Why created:** Each sub-agent needs an isolated workspace (branch + directory) to avoid conflicts
- **Role:**
  - `create_worktree()` — creates a new worktree on a new branch
  - `remove_worktree()` — cleans up after agent completes
  - `commit_changes()` — stages and commits in a worktree
  - `merge_branch()` — merges a sub-agent's branch back to main
  - `get_diff()` — shows what a sub-agent changed
  - `get_file_tree()` — generates repo structure for LLM context
  - `read_files()` / `write_file()` — file I/O within worktrees
- **Importance:** 🔴 Critical — this is what makes parallel agent work possible without conflicts

---

### 18. `api/websocket/manager.py`
- **Purpose:** WebSocket connection manager for real-time UI updates
- **Why created:** The UI needs live updates when agents spawn, complete tasks, or send messages
- **Role:**
  - Manages connections per channel (e.g., `chat:session-123`, `metrics`)
  - `broadcast()` — send event to all connections on a channel
  - `broadcast_all()` — send to every connected client
  - `send_to_session()` — target a specific chat session
- **Importance:** 🟡 Medium — system works without it (polling), but real-time UX requires it

---

### 19. `api/services/task_planner.py`
- **Purpose:** LLM-powered task decomposition engine
- **Why created:** Jason needs to break user requests into subtasks for sub-agents
- **Role:**
  - Contains the planning system prompt that instructs the LLM to output structured JSON
  - `create_task_plan()` — takes user message + repo file tree, returns `TaskPlan` JSON
  - Output includes: task IDs, titles, descriptions, file scopes, dependencies, priorities
- **Importance:** 🔴 Critical — this is Jason's "brain" for planning. Quality of decomposition determines quality of results.

---

### 20. `api/services/sub_agent.py`
- **Purpose:** Sub-agent lifecycle — execution logic for worker agents
- **Why created:** Each sub-agent needs to: read files → call LLM → parse response → apply changes → commit
- **Role:**
  - `build_agent_prompt()` — creates a scoped system prompt for the sub-agent
  - `execute_sub_agent()` — the main execution loop:
    1. Updates status to "busy"
    2. Reads relevant files from worktree
    3. Calls LLM with task-specific prompt
    4. Parses JSON response for file changes
    5. Applies changes to worktree files
    6. Commits changes to git
    7. Updates status to "completed" or "failed"
  - `_apply_agent_changes()` — parses LLM output and writes files
- **Importance:** 🔴 Critical — this is where actual code changes happen

---

### 21. `api/services/jason.py`
- **Purpose:** The Jason master agent orchestrator — the central brain
- **Why created:** This is the core of the entire system. Jason receives user messages, plans, spawns agents, monitors, merges.
- **Role:** `JasonOrchestrator` class with:
  - `ensure_jason_exists()` — creates/finds Jason in DB
  - `handle_user_message()` — main entry point:
    1. Gets repo file tree
    2. Calls task planner to decompose request
    3. Creates parent mission + sub-missions in DB
    4. Spawns sub-agents with git worktrees
    5. Starts monitoring loop
    6. Returns immediate response to user
  - `_spawn_sub_agent()` — creates worktree, agent record, chat session, launches async task
  - `_monitor_mission()` — polls sub-agent statuses, handles dependencies, retries, failures
  - `_finalize_mission()` — merges all branches, cleans up worktrees, reports to user
  - `_direct_response()` — for simple requests that don't need sub-agents
- **Importance:** 🔴🔴 MOST CRITICAL — this is the orchestrator. Everything revolves around this.

---

### 22. `api/services/metrics.py`
- **Purpose:** System metrics collection
- **Why created:** The System Metrics page in the UI needs real data
- **Role:** `get_system_metrics()` — returns CPU%, memory, disk, active agent count
- **Importance:** 🟢 Low — nice-to-have, not core functionality

---

### 23. `api/routers/__init__.py`
- **Purpose:** Empty init for the routers package
- **Role:** Package marker
- **Importance:** 🟢 Low

---

### 24. `api/routers/auth.py`
- **Purpose:** Authentication API endpoints
- **Why created:** Login page needs a real backend instead of hardcoded credentials
- **Role:**
  - `POST /api/auth/login` — validates credentials, returns JWT
  - `POST /api/auth/register` — creates new user
  - `GET /api/auth/me` — returns current user info from token
  - `get_current_user()` — FastAPI dependency for protected routes
  - `hash_password()` / `verify_password()` — bcrypt-based password hashing
- **Importance:** 🟡 Medium — security layer. Currently endpoints are open; auth can be enforced later.
- **Bug fix:** Replaced `passlib` with direct `bcrypt` usage due to compatibility issue with bcrypt 5.x

---

### 25. `api/routers/agents.py`
- **Purpose:** Agent CRUD API endpoints
- **Why created:** The Agents Pool UI page needs dynamic data
- **Role:**
  - `GET /api/agents` — list all agents (Jason + sub-agents)
  - `GET /api/agents/{id}` — get agent details with children
  - `PUT /api/agents/{id}` — update agent status
  - `DELETE /api/agents/{id}` — terminate a sub-agent (cannot terminate Jason)
- **Importance:** 🟡 Medium — UI needs this to show live agent status

---

### 26. `api/routers/missions.py`
- **Purpose:** Mission CRUD API endpoints
- **Why created:** The Mission Board (Kanban) needs persistent data
- **Role:**
  - `GET /api/missions` — list all missions with agent names resolved
  - `GET /api/missions/{id}` — get mission with subtasks
  - `POST /api/missions` — create mission manually
  - `PUT /api/missions/{id}` — update mission (status, title, etc.)
  - `DELETE /api/missions/{id}` — delete mission
- **Importance:** 🔴 Critical — the Kanban board is the primary UI view

---

### 27. `api/routers/chat.py`
- **Purpose:** Chat API endpoints + WebSocket + legacy compatibility
- **Why created:** Chat is the primary user↔Jason interface
- **Role:**
  - **New session-based endpoints:**
    - `GET /api/chat/sessions` — list chat sessions
    - `POST /api/chat/sessions` — create new session
    - `GET /api/chat/sessions/{id}/messages` — get messages
    - `POST /api/chat/sessions/{id}/send` — send message → Jason processes → responds
  - **Legacy endpoints (existing UI compatibility):**
    - `GET /api/chat/history` — returns messages from most recent session
    - `POST /api/chat/send` — sends message, Jason processes and responds
  - **WebSocket:**
    - `WS /api/chat/ws/{session_id}` — real-time message streaming
- **Importance:** 🔴 Critical — this is where user messages enter the system and trigger Jason

---

### 28. `api/routers/metrics.py`
- **Purpose:** System metrics API + WebSocket stream
- **Why created:** System Metrics UI page (currently "Coming Soon")
- **Role:**
  - `GET /api/metrics` — returns CPU, memory, disk, agent counts
  - `WS /api/metrics/ws` — streams metrics every 3 seconds
- **Importance:** 🟢 Low — future feature

---

### 29. `api/main.py` (rewritten)
- **Purpose:** FastAPI application entry point — wires everything together
- **Why created:** Replaced the old in-memory prototype with the full architecture
- **Role:**
  - `lifespan()` — startup hook that:
    1. Initializes database (creates tables)
    2. Ensures Jason master agent exists
    3. Seeds default admin user (`admin` / `Oc123`)
  - Registers all routers (auth, agents, missions, chat, metrics)
  - Configures CORS for frontend dev server
  - `GET /api/health` — health check endpoint
- **Importance:** 🔴 Critical — the entry point. `uvicorn main:app` starts everything.

---

## Architecture Layer Diagram

```
Layer 1: Entry Point
  └── main.py (FastAPI app, lifespan, CORS, router registration)

Layer 2: Configuration
  ├── config.py (Pydantic Settings, reads .env)
  └── .env (environment variables)

Layer 3: Data Layer
  ├── database.py (async engine, session factory, init_db)
  └── models/ (User, Agent, Mission, MissionDependency, ChatSession, ChatMessage)

Layer 4: Validation Layer
  └── schemas/ (Pydantic request/response models for each entity)

Layer 5: Service Layer (Business Logic)
  ├── services/jason.py ← THE ORCHESTRATOR
  ├── services/task_planner.py (LLM-powered decomposition)
  ├── services/sub_agent.py (worker agent execution)
  ├── services/llm_client.py (OpenRouter API client)
  ├── services/git_manager.py (worktree lifecycle)
  └── services/metrics.py (system stats)

Layer 6: API Layer
  ├── routers/auth.py (JWT login/register)
  ├── routers/agents.py (agent CRUD)
  ├── routers/missions.py (mission CRUD)
  ├── routers/chat.py (chat + Jason integration)
  └── routers/metrics.py (system metrics)

Layer 7: Real-Time Layer
  └── websocket/manager.py (connection management, broadcasting)
```

---

## Verification Results

| Test | Result |
|---|---|
| `GET /api/health` | ✅ `{"status": "ok"}` |
| `GET /api/agents` | ✅ Returns Jason (master, active) |
| `POST /api/auth/login` | ✅ Returns JWT token for admin user |
| Server startup | ✅ DB initialized, Jason created, admin seeded |

---

## Bug Encountered & Fixed

**Issue:** `passlib` 1.7.4 is incompatible with `bcrypt` 5.x — crashes on `bcrypt.hashpw()` with `ValueError: password cannot be longer than 72 bytes`  
**Root cause:** `passlib` tries to detect bcrypt bugs using internal APIs that changed in bcrypt 5.x  
**Fix:** Replaced `passlib` with direct `bcrypt` 4.2.1 usage in `routers/auth.py`

---

## What's Next (design_2.md)

- Wire the existing React UI to the new backend endpoints
- Update `api.ts` to use new session-based chat endpoints
- Update `Agents.tsx` to fetch from `/api/agents` instead of hardcoded data
- Update `Chat.tsx` to work with Jason's real responses
- Update `Login.tsx` to use `/api/auth/login`
