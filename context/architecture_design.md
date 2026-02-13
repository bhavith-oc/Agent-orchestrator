# AETHER Orchestrator — Architecture Design Document

## 1. Executive Summary

**AETHER Orchestrator** is an AI agent orchestration platform built around a master agent called **Jason**. Jason runs inside an OpenClaw container, receives user requests via chat, decomposes them into subtasks, spawns sub-agents to execute each task in isolated git worktrees, monitors their progress, merges results, and reports back to the user.

### Key Principles

- **Single master, many workers** — Jason is the brain; sub-agents are the hands
- **Git-native isolation** — each sub-agent works on its own branch via `git worktree`
- **LLM-agnostic** — supports OpenAI, Anthropic, Ollama, or any OpenAI-compatible API
- **Real-time visibility** — the dashboard reflects live agent status, task progress, and chat

---

## 2. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      OpenClaw Container                         │
│                                                                 │
│  ┌──────────┐    ┌──────────────────────────────────────────┐   │
│  │  React   │◄──►│           FastAPI Backend                │   │
│  │   UI     │    │                                          │   │
│  │ (Vite)   │    │  ┌─────────────────────────────────┐     │   │
│  └──────────┘    │  │     JASON (Master Agent)        │     │   │
│                  │  │                                 │     │   │
│                  │  │  ┌───────────┐ ┌────────────┐   │     │   │
│                  │  │  │   Task    │ │  Agent     │   │     │   │
│                  │  │  │  Planner  │ │  Spawner   │   │     │   │
│                  │  │  │  (LLM)   │ │            │   │     │   │
│                  │  │  └───────────┘ └─────┬──────┘   │     │   │
│                  │  │                      │          │     │   │
│                  │  │  ┌───────────────────┼────────┐ │     │   │
│                  │  │  │    Monitor &      │        │ │     │   │
│                  │  │  │    Aggregator     │        │ │     │   │
│                  │  │  └──────────┬────────┘        │ │     │   │
│                  │  └─────────────┼─────────────────┘ │     │   │
│                  │                │                    │     │   │
│                  │  ┌─────────────▼──────────────────┐│     │   │
│                  │  │       Sub-Agent Pool           ││     │   │
│                  │  │                                ││     │   │
│                  │  │  ┌─────────┐  ┌─────────┐     ││     │   │
│                  │  │  │Agent A  │  │Agent B  │ ... ││     │   │
│                  │  │  │(branch) │  │(branch) │     ││     │   │
│                  │  │  │worktree │  │worktree │     ││     │   │
│                  │  │  └─────────┘  └─────────┘     ││     │   │
│                  │  └────────────────────────────────┘│     │   │
│                  │                                    │     │   │
│                  │  ┌────────────┐  ┌──────────────┐  │     │   │
│                  │  │  SQLite    │  │ Git Worktree │  │     │   │
│                  │  │  Database  │  │   Manager    │  │     │   │
│                  │  └────────────┘  └──────────────┘  │     │   │
│                  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Core Components

### 3.1 Jason — Master Agent

Jason is the central orchestrator. It is **not** a simple router — it is an LLM-powered agent that:

1. **Receives** user messages via the Chat API
2. **Analyzes** the request using an LLM (planning prompt)
3. **Decomposes** the request into a task plan (list of subtasks with dependencies)
4. **Assigns** each subtask to a sub-agent with a scoped system prompt
5. **Monitors** sub-agent progress (polling their status in the DB)
6. **Merges** completed work (git merge from sub-agent branches)
7. **Reports** results back to the user

**Jason's LLM Context:**
- System prompt defining its role as an orchestrator
- The repository structure (file tree)
- The user's message
- History of previous interactions

**Jason's Planning Output (structured JSON):**
```json
{
  "plan_summary": "Refactor authentication module and add unit tests",
  "tasks": [
    {
      "id": "task-001",
      "title": "Refactor auth middleware",
      "description": "Extract JWT validation into a separate utility...",
      "files_scope": ["src/middleware/auth.ts", "src/utils/jwt.ts"],
      "depends_on": [],
      "priority": "high"
    },
    {
      "id": "task-002",
      "title": "Write unit tests for auth",
      "description": "Create test suite for the refactored auth module...",
      "files_scope": ["tests/auth.test.ts"],
      "depends_on": ["task-001"],
      "priority": "medium"
    }
  ]
}
```

### 3.2 Sub-Agent Framework

Each sub-agent is an **async task** running within the FastAPI process. A sub-agent:

- Has its own **chat session** with an LLM (separate context/history)
- Operates in its own **git worktree** (isolated branch + working directory)
- Has a **scoped system prompt** that includes:
  - The specific task description from Jason's plan
  - The list of files it's allowed to read/modify
  - Instructions to commit changes when done
- Reports status updates to the database
- Can request clarification from Jason (not the user directly)

**Sub-Agent States:**
```
Spawning → Active → Working → Committing → Completed
                                    ↓
                                  Failed → Retrying → Active
                                    ↓
                                  Aborted
```

### 3.3 Git Worktree Manager

Manages the lifecycle of git worktrees for sub-agents.

**Operations:**

| Operation | Command | When |
|---|---|---|
| **Create worktree** | `git worktree add ../worktrees/agent-{id} -b agent/task-{id}` | Sub-agent spawned |
| **List worktrees** | `git worktree list` | Status check |
| **Commit changes** | `git -C {worktree_path} add . && git commit -m "{msg}"` | Sub-agent completes |
| **Merge to main** | `git merge agent/task-{id}` | Jason aggregates |
| **Remove worktree** | `git worktree remove ../worktrees/agent-{id}` | Cleanup |
| **Delete branch** | `git branch -d agent/task-{id}` | Cleanup |

**Directory Structure:**
```
/repo/                          ← Main repo (Jason's view)
  ├── .git/
  ├── src/
  ├── ...
/repo-worktrees/                ← Worktree root (outside main repo)
  ├── agent-task-001/           ← Sub-agent A's isolated workspace
  │   ├── src/
  │   └── ...
  ├── agent-task-002/           ← Sub-agent B's isolated workspace
  │   ├── src/
  │   └── ...
  └── ...
```

### 3.4 Task Planner

The Task Planner is the LLM-powered component inside Jason that converts a user request into a structured task plan.

**Planning Prompt Template:**
```
You are Jason, an AI orchestrator. Given a user request and the repository structure,
decompose the request into independent subtasks that can be executed by separate agents.

Rules:
- Each task should have a clear, non-overlapping file scope
- Identify dependencies between tasks (task B depends on task A)
- Assign priority: high (blocking), medium (important), low (nice-to-have)
- Keep tasks granular — one concern per task
- Output valid JSON matching the TaskPlan schema

Repository structure:
{file_tree}

User request:
{user_message}
```

---

## 4. Data Flow

### 4.1 Complete Request Lifecycle

```
Step 1: User sends message
  UI (Chat) → POST /api/chat/send → Backend receives message

Step 2: Jason plans
  Backend → Jason.plan(message) → LLM call → TaskPlan JSON

Step 3: Missions created
  Backend → Create Mission (parent) in DB
  Backend → Create Sub-Missions in DB (one per task in plan)

Step 4: Sub-agents spawned
  For each sub-mission:
    → Git Worktree Manager creates worktree + branch
    → Sub-Agent spawned as async task
    → Agent record created in DB (status: Active)

Step 5: Sub-agents execute
  Each sub-agent:
    → Reads relevant files from its worktree
    → Calls LLM with task-specific prompt
    → Applies changes to files in worktree
    → Commits changes
    → Updates status in DB (status: Completed)

Step 6: Jason monitors
  Jason polls DB for sub-agent statuses
  Handles dependencies (starts task-002 when task-001 completes)
  Handles failures (retry or reassign)

Step 7: Jason merges
  When all sub-agents complete:
    → Git Worktree Manager merges each branch into main
    → Resolves conflicts if any (or flags for user)
    → Cleans up worktrees and branches

Step 8: Jason responds
  Jason → Generates summary of all changes
  Backend → POST response to chat
  UI updates: Chat shows response, Mission Board shows completed tasks
```

### 4.2 Real-Time Updates (WebSocket)

For live UI updates without polling:

```
Backend ──WebSocket──► UI

Events:
  - agent:spawned      { agent_id, name, task }
  - agent:status       { agent_id, status, progress }
  - mission:updated    { mission_id, status }
  - chat:message       { session_id, role, content }
  - merge:completed    { branch, status, conflicts }
```

---

## 5. Database Schema

Using **SQLite** with **SQLAlchemy ORM** for persistence.

### 5.1 Tables

```sql
-- Users (for authentication)
CREATE TABLE users (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)))),
    username    TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role        TEXT DEFAULT 'user',  -- 'admin', 'user'
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Agents (Jason + sub-agents)
CREATE TABLE agents (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)))),
    name            TEXT NOT NULL,
    type            TEXT NOT NULL,       -- 'master', 'sub'
    status          TEXT DEFAULT 'idle', -- 'idle', 'active', 'busy', 'completed', 'failed', 'offline'
    parent_agent_id TEXT REFERENCES agents(id),
    model           TEXT,                -- 'gpt-4', 'claude-3.5', 'llama-3', etc.
    system_prompt   TEXT,
    config          TEXT,                -- JSON blob for extra config
    worktree_path   TEXT,                -- Path to git worktree (sub-agents only)
    git_branch      TEXT,                -- Branch name (sub-agents only)
    current_task    TEXT,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    terminated_at   TIMESTAMP
);

-- Missions (parent tasks + subtasks)
CREATE TABLE missions (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)))),
    title           TEXT NOT NULL,
    description     TEXT,
    status          TEXT DEFAULT 'queue', -- 'queue', 'active', 'completed', 'failed'
    priority        TEXT DEFAULT 'general', -- 'general', 'urgent'
    parent_mission_id TEXT REFERENCES missions(id),
    assigned_agent_id TEXT REFERENCES agents(id),
    files_scope     TEXT,                -- JSON array of file paths this mission touches
    git_branch      TEXT,
    plan_json       TEXT,                -- Full task plan (only on parent missions)
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at      TIMESTAMP,
    completed_at    TIMESTAMP
);

-- Mission Dependencies
CREATE TABLE mission_dependencies (
    mission_id      TEXT REFERENCES missions(id),
    depends_on_id   TEXT REFERENCES missions(id),
    PRIMARY KEY (mission_id, depends_on_id)
);

-- Chat Sessions
CREATE TABLE chat_sessions (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)))),
    type            TEXT NOT NULL,       -- 'user' (user↔Jason), 'agent' (Jason↔sub-agent)
    agent_id        TEXT REFERENCES agents(id),
    mission_id      TEXT REFERENCES missions(id),
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Chat Messages
CREATE TABLE chat_messages (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)))),
    session_id      TEXT REFERENCES chat_sessions(id),
    role            TEXT NOT NULL,       -- 'user', 'agent', 'system'
    sender_name     TEXT,
    content         TEXT NOT NULL,
    files           TEXT,                -- JSON array of file attachments
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 5.2 Entity Relationships

```
users ──1:N──► chat_sessions (user can have multiple conversations)

agents ──1:N──► agents (Jason spawns sub-agents, self-referencing)
agents ──1:N──► missions (agent assigned to missions)
agents ──1:1──► chat_sessions (each agent has a chat session)

missions ──1:N──► missions (parent mission has subtasks)
missions ──N:N──► missions (via mission_dependencies)
missions ──1:1──► chat_sessions (mission may have associated chat)

chat_sessions ──1:N──► chat_messages
```

---

## 6. API Endpoints

### 6.1 Authentication

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/login` | Login, returns JWT token |
| POST | `/api/auth/register` | Register new user (admin only) |
| GET | `/api/auth/me` | Get current user info |

**Login Request:**
```json
{ "username": "admin", "password": "..." }
```

**Login Response:**
```json
{ "access_token": "eyJ...", "token_type": "bearer", "user": { "id": "...", "username": "admin", "role": "admin" } }
```

### 6.2 Chat (User ↔ Jason)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/chat/sessions` | List all chat sessions |
| POST | `/api/chat/sessions` | Create new chat session |
| GET | `/api/chat/sessions/{id}/messages` | Get messages for a session |
| POST | `/api/chat/sessions/{id}/send` | Send message to Jason |
| WS | `/api/chat/ws/{session_id}` | WebSocket for real-time messages |

**Send Message Flow:**
```
POST /api/chat/sessions/{id}/send
Body: { "content": "Refactor the auth module and add tests" }

Response: { "message_id": "...", "status": "processing" }

→ Jason receives message
→ Jason plans tasks
→ Sub-agents spawned
→ Real-time updates via WebSocket
→ Final response posted to chat when complete
```

### 6.3 Agents

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/agents` | List all agents (Jason + sub-agents) |
| GET | `/api/agents/{id}` | Get agent details |
| GET | `/api/agents/{id}/logs` | Get agent execution logs |
| POST | `/api/agents/spawn` | Manually spawn a new agent (admin) |
| PUT | `/api/agents/{id}/status` | Update agent status |
| DELETE | `/api/agents/{id}` | Terminate and remove agent |

**Agent Response:**
```json
{
  "id": "a-001",
  "name": "Jason",
  "type": "master",
  "status": "active",
  "model": "gpt-4",
  "current_task": "Monitoring 3 sub-agents",
  "children": [
    { "id": "a-002", "name": "RefactorAgent", "status": "working", "task": "Refactor auth middleware" },
    { "id": "a-003", "name": "TestAgent", "status": "queued", "task": "Write auth tests" }
  ]
}
```

### 6.4 Missions

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/missions` | List all missions (with subtasks) |
| GET | `/api/missions/{id}` | Get mission details + subtasks |
| POST | `/api/missions` | Create mission manually |
| PUT | `/api/missions/{id}` | Update mission |
| DELETE | `/api/missions/{id}` | Delete mission |
| GET | `/api/missions/{id}/diff` | Get git diff for mission's branch |

### 6.5 System Metrics

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/metrics` | System resource usage |
| GET | `/api/metrics/agents` | Per-agent resource usage |
| WS | `/api/metrics/ws` | Real-time metrics stream |

**Metrics Response:**
```json
{
  "cpu_percent": 45.2,
  "memory_used_mb": 1024,
  "memory_total_mb": 4096,
  "active_agents": 3,
  "active_worktrees": 3,
  "disk_used_mb": 512,
  "llm_tokens_used": 15420,
  "uptime_seconds": 3600
}
```

---

## 7. Sub-Agent Lifecycle

### 7.1 Spawn

```python
async def spawn_sub_agent(task: Task, parent_agent: Agent) -> Agent:
    # 1. Create git worktree
    branch_name = f"agent/task-{task.id}"
    worktree_path = git_manager.create_worktree(branch_name)

    # 2. Build scoped system prompt
    system_prompt = build_agent_prompt(
        task=task,
        files_scope=task.files_scope,
        repo_context=get_file_tree(worktree_path)
    )

    # 3. Create agent record in DB
    agent = Agent(
        name=f"Agent-{task.id}",
        type="sub",
        status="active",
        parent_agent_id=parent_agent.id,
        model=parent_agent.model,  # inherit or override
        system_prompt=system_prompt,
        worktree_path=worktree_path,
        git_branch=branch_name,
        current_task=task.title
    )
    db.add(agent)

    # 4. Create chat session for agent
    session = ChatSession(type="agent", agent_id=agent.id, mission_id=task.id)
    db.add(session)

    # 5. Launch async execution
    asyncio.create_task(execute_sub_agent(agent, task, session))

    return agent
```

### 7.2 Execute

```python
async def execute_sub_agent(agent: Agent, task: Task, session: ChatSession):
    try:
        agent.status = "working"
        db.commit()

        # 1. Read relevant files from worktree
        file_contents = read_files(agent.worktree_path, task.files_scope)

        # 2. Build messages for LLM
        messages = [
            {"role": "system", "content": agent.system_prompt},
            {"role": "user", "content": f"Task: {task.description}\n\nRelevant files:\n{file_contents}"}
        ]

        # 3. Call LLM
        response = await llm_client.chat(model=agent.model, messages=messages)

        # 4. Parse response — extract file changes
        changes = parse_agent_response(response)

        # 5. Apply changes to worktree
        apply_file_changes(agent.worktree_path, changes)

        # 6. Commit
        git_manager.commit(agent.worktree_path, f"[{agent.name}] {task.title}")

        # 7. Update status
        agent.status = "completed"
        task.status = "completed"
        task.completed_at = datetime.utcnow()
        db.commit()

    except Exception as e:
        agent.status = "failed"
        log_error(agent, e)
        db.commit()
        # Jason will handle retry logic
```

### 7.3 Monitor (Jason's Loop)

```python
async def monitor_mission(mission: Mission, sub_agents: list[Agent]):
    while True:
        statuses = {a.id: a.status for a in sub_agents}

        # Check if all completed
        if all(s == "completed" for s in statuses.values()):
            await merge_all_branches(mission, sub_agents)
            mission.status = "completed"
            break

        # Check for failures
        failed = [a for a in sub_agents if a.status == "failed"]
        for agent in failed:
            if agent.retry_count < MAX_RETRIES:
                await retry_agent(agent)
            else:
                mission.status = "failed"
                await notify_user(f"Task '{agent.current_task}' failed after {MAX_RETRIES} retries")
                break

        # Check dependencies — start queued tasks whose deps are met
        for agent in sub_agents:
            if agent.status == "queued":
                deps = get_dependencies(agent.task)
                if all(dep.status == "completed" for dep in deps):
                    await activate_agent(agent)

        await asyncio.sleep(POLL_INTERVAL_SECONDS)  # e.g., 2 seconds
```

---

## 8. Git Worktree Strategy

### 8.1 Branch Naming Convention

```
main                          ← Stable branch
├── agent/mission-{mission_id}  ← Parent mission branch (optional)
│   ├── agent/task-{task_id}    ← Sub-agent branch
│   ├── agent/task-{task_id}    ← Sub-agent branch
│   └── ...
```

### 8.2 Merge Strategy

```
1. Sub-agent completes → commits on its branch
2. Jason merges sub-agent branches into parent mission branch (or directly into main)
3. Merge order follows dependency graph (task-001 merged before task-002)
4. If conflict detected:
   a. Attempt auto-resolve (git merge with default strategy)
   b. If unresolvable, flag to user with diff
   c. User resolves manually or asks Jason to attempt resolution
```

### 8.3 Conflict Prevention

Jason's planner is instructed to:
- Assign **non-overlapping file scopes** to sub-agents
- If two tasks must touch the same file, make them **sequential** (dependency)
- Use **file-level locking** as a safety net (tracked in DB)

### 8.4 Cleanup

After mission completion:
```bash
# Remove all worktrees for this mission
git worktree remove ../worktrees/agent-task-001
git worktree remove ../worktrees/agent-task-002

# Delete branches
git branch -d agent/task-001
git branch -d agent/task-002
```

---

## 9. LLM Integration

### 9.1 Provider-Agnostic Client

```python
class LLMClient:
    """Unified interface for multiple LLM providers."""

    def __init__(self, provider: str, api_key: str, base_url: str = None):
        self.provider = provider  # 'openai', 'anthropic', 'ollama'
        self.api_key = api_key
        self.base_url = base_url

    async def chat(self, model: str, messages: list[dict], **kwargs) -> str:
        if self.provider == "openai":
            return await self._openai_chat(model, messages, **kwargs)
        elif self.provider == "anthropic":
            return await self._anthropic_chat(model, messages, **kwargs)
        elif self.provider == "ollama":
            return await self._ollama_chat(model, messages, **kwargs)
```

### 9.2 Supported Providers

| Provider | Models | Use Case |
|---|---|---|
| **OpenAI** | gpt-4, gpt-4o, gpt-3.5-turbo | General purpose, planning |
| **Anthropic** | claude-3.5-sonnet, claude-3-opus | Code analysis, research |
| **Ollama** (local) | llama3, codellama, mistral | Privacy-sensitive, offline |

### 9.3 Configuration

```yaml
# config.yaml
llm:
  default_provider: "openai"
  default_model: "gpt-4"
  providers:
    openai:
      api_key: "${OPENAI_API_KEY}"
    anthropic:
      api_key: "${ANTHROPIC_API_KEY}"
    ollama:
      base_url: "http://localhost:11434"
  jason:
    model: "gpt-4"           # Jason uses the most capable model
    temperature: 0.3          # Low temp for planning
    max_tokens: 4096
  sub_agents:
    model: "gpt-4o"           # Sub-agents can use faster/cheaper model
    temperature: 0.2
    max_tokens: 8192
```

---

## 10. UI ↔ Backend Mapping

| UI Component | Backend Source | Notes |
|---|---|---|
| **Login** | `POST /api/auth/login` | JWT-based, replaces hardcoded auth |
| **Chat (Agent Hub)** | `GET/POST /api/chat/sessions/{id}/*` + WebSocket | User ↔ Jason conversation |
| **Mission Board** | `GET /api/missions` | Kanban: Queue/Active/Completed. Parent missions + subtasks |
| **Agents Pool** | `GET /api/agents` | Dynamic list. Jason = master, others = sub-agents with live status |
| **Create Mission Modal** | `POST /api/chat/sessions/{id}/send` | User describes task in chat → Jason creates missions automatically. Manual creation also supported via `POST /api/missions` |
| **System Metrics** | `GET /api/metrics` + WebSocket | CPU, memory, active agents, LLM token usage |
| **Settings** | `GET/PUT /api/settings` | LLM provider config, default model, etc. |

### 10.1 UI Changes Required

| Component | Change |
|---|---|
| **Chat.tsx** | Replace hardcoded agents sidebar with dynamic `GET /api/agents`. Replace fake response with WebSocket listener. |
| **Agents.tsx** | Replace hardcoded agent list with `GET /api/agents`. Add real-time status updates via WebSocket. Wire "Deploy New Agent" button. |
| **Dashboard.tsx** | Add subtask nesting (parent mission → child tasks). Show assigned agent on each card. Show git branch name. |
| **Login.tsx** | Call `POST /api/auth/login` instead of hardcoded check. Store JWT in localStorage. |
| **MissionContext.tsx** | Add WebSocket connection for real-time mission updates. |
| **api.ts** | Add auth headers (Bearer token). Add agents, metrics, settings endpoints. Add WebSocket helpers. |

---

## 11. Error Handling & Recovery

### 11.1 Sub-Agent Failures

| Failure Type | Recovery |
|---|---|
| **LLM API error** (rate limit, timeout) | Retry with exponential backoff (max 3 retries) |
| **Invalid LLM response** (unparseable) | Retry with stricter prompt |
| **Git conflict on commit** | Abort, notify Jason, Jason reassigns or resolves |
| **File not found** | Agent reports error, Jason adjusts file scope |
| **Agent crash** (process dies) | Jason detects via status poll, respawns agent |

### 11.2 Jason Failures

| Failure Type | Recovery |
|---|---|
| **Planning fails** | Respond to user with error, ask for clarification |
| **Merge conflict** | Present diff to user, ask for resolution |
| **All retries exhausted** | Mark mission as failed, notify user |

### 11.3 System-Level

| Failure Type | Recovery |
|---|---|
| **Container restart** | DB persists state. On startup, Jason checks for in-progress missions and resumes monitoring. Orphaned worktrees are cleaned up. |
| **DB corruption** | WAL mode for SQLite crash safety. Regular backups. |

---

## 12. Security Considerations

- **JWT Authentication** — all API endpoints (except login) require valid token
- **API Keys** — LLM provider keys stored in environment variables, never in DB or code
- **Git Worktree Isolation** — sub-agents can only access their assigned worktree path
- **File Scope Enforcement** — sub-agents are instructed (via prompt) to only modify files in their scope; backend validates commits
- **Rate Limiting** — prevent abuse of chat/agent spawn endpoints
- **Input Sanitization** — user messages sanitized before passing to LLM

---

## 13. Configuration

### 13.1 Environment Variables

```bash
# Server
HOST=0.0.0.0
PORT=8000
SECRET_KEY=your-jwt-secret-key

# Database
DATABASE_URL=sqlite:///./aether.db

# LLM Providers
LLM_PROVIDER=openai                    # openai | anthropic | ollama
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
OLLAMA_BASE_URL=http://localhost:11434

# Jason Config
JASON_MODEL=gpt-4
JASON_TEMPERATURE=0.3

# Sub-Agent Config
SUB_AGENT_MODEL=gpt-4o
SUB_AGENT_MAX_RETRIES=3

# Git
REPO_PATH=/path/to/target/repo
WORKTREE_BASE_PATH=/path/to/worktrees
```

---

## 14. Project Structure (Backend)

```
api/
├── main.py                  # FastAPI app entry point
├── config.py                # Configuration loader
├── database.py              # SQLAlchemy setup + session management
├── models/
│   ├── __init__.py
│   ├── user.py              # User model
│   ├── agent.py             # Agent model
│   ├── mission.py           # Mission + dependencies models
│   └── chat.py              # ChatSession + ChatMessage models
├── schemas/
│   ├── __init__.py
│   ├── auth.py              # Pydantic schemas for auth
│   ├── agent.py             # Pydantic schemas for agents
│   ├── mission.py           # Pydantic schemas for missions
│   └── chat.py              # Pydantic schemas for chat
├── routers/
│   ├── __init__.py
│   ├── auth.py              # Auth endpoints
│   ├── agents.py            # Agent endpoints
│   ├── missions.py          # Mission endpoints
│   ├── chat.py              # Chat endpoints
│   └── metrics.py           # Metrics endpoints
├── services/
│   ├── __init__.py
│   ├── jason.py             # Jason master agent logic
│   ├── sub_agent.py         # Sub-agent lifecycle management
│   ├── task_planner.py      # LLM-powered task decomposition
│   ├── git_manager.py       # Git worktree operations
│   ├── llm_client.py        # Provider-agnostic LLM client
│   └── metrics.py           # System metrics collection
├── websocket/
│   ├── __init__.py
│   └── manager.py           # WebSocket connection manager
├── requirements.txt
└── README.md
```

---

## 15. Future Roadmap

### Phase 1 (MVP) — Current Focus
- [x] UI: Dashboard, Chat, Agents Pool, Login
- [ ] Backend: DB + Auth + Agents API + Missions API
- [ ] Jason: Basic planning + sub-agent spawn
- [ ] Git worktree integration
- [ ] Chat connected to Jason

### Phase 2 — Enhanced Intelligence
- [ ] Multi-turn sub-agent conversations (agent asks Jason for clarification)
- [ ] Smarter conflict resolution (LLM-assisted merge)
- [ ] Agent memory (persistent context across missions)
- [ ] File change preview before merge (diff viewer in UI)

### Phase 3 — Scale & Polish
- [ ] System Metrics dashboard (real-time charts)
- [ ] Settings page (configure LLM providers, models, etc.)
- [ ] Multi-repo support (Jason manages multiple repositories)
- [ ] Agent templates (pre-configured agents for common tasks)
- [ ] Audit log (full history of all agent actions)
- [ ] Plugin system (custom agent behaviors)

---

## 16. Glossary

| Term | Definition |
|---|---|
| **Jason** | The master AI agent that orchestrates all work |
| **Sub-Agent** | A worker agent spawned by Jason for a specific task |
| **Mission** | A top-level user request (may contain subtasks) |
| **Task** | A subtask within a mission, assigned to a sub-agent |
| **Worktree** | A git worktree — an isolated working directory on its own branch |
| **OpenClaw** | The container environment where all agents run |
| **Neural Link** | UI term for the chat interface between user and Jason |
| **Agent Pool** | The collection of all active agents (Jason + sub-agents) |
