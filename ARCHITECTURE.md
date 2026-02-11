# Aether Orchestrator — Architecture

## System Overview

Aether Orchestrator is a full-stack platform for deploying, managing, and chatting with autonomous AI agents powered by [OpenClaw](https://github.com/openclaw/openclaw). It provides a React frontend, a FastAPI backend, and Docker-based one-click agent deployment.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Browser (React UI)                           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │Onboarding│ │Dashboard │ │Agent Hub │ │  Deploy  │ │ Settings │ │
│  │  Flow    │ │(Missions)│ │  (Chat)  │ │  Agent   │ │(Remote)  │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ │
│       └─────────────┴─────────┬──┴────────────┴────────────┘       │
│                               │ HTTP + WebSocket                    │
└───────────────────────────────┼─────────────────────────────────────┘
                                │
┌───────────────────────────────┼─────────────────────────────────────┐
│                    FastAPI Backend (:8000)                           │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────┐  │
│  │  Auth   │ │Missions │ │  Chat   │ │ Deploy  │ │   Remote    │  │
│  │ Router  │ │ Router  │ │ Router  │ │ Router  │ │   Router    │  │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └──────┬──────┘  │
│       │           │           │           │              │          │
│  ┌────┴────┐ ┌────┴────┐ ┌───┴────┐ ┌────┴─────┐ ┌──────┴──────┐  │
│  │  JWT +  │ │  Jason  │ │  WS    │ │Deployer  │ │RemoteJason  │  │
│  │ Google  │ │Orchestr.│ │Manager │ │ Service  │ │  Client     │  │
│  │  OAuth  │ │         │ │        │ │          │ │             │  │
│  └─────────┘ └────┬────┘ └────────┘ └────┬─────┘ └──────┬──────┘  │
│                   │                      │               │          │
│              ┌────┴────┐           ┌─────┴──────┐  ┌─────┴──────┐  │
│              │Sub-Agent│           │  Docker    │  │  OpenClaw  │  │
│              │Executor │           │  Compose   │  │  Gateway   │  │
│              │+ LLM    │           │  Engine    │  │  (Remote)  │  │
│              └────┬────┘           └─────┬──────┘  └────────────┘  │
│                   │                      │                          │
│              ┌────┴────┐           ┌─────┴──────┐                   │
│              │OpenRouter│          │  OpenClaw  │                   │
│              │  API     │          │ Container  │                   │
│              └──────────┘          │  (Local)   │                   │
│                                    └────────────┘                   │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    SQLite (aether.db)                        │   │
│  │  Users │ Agents │ Missions │ ChatSessions │ ChatMessages     │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
Agent-orchestrator/
├── api/                          # FastAPI backend
│   ├── main.py                   # App entry point, lifespan, router registration
│   ├── config.py                 # Pydantic settings (env-based config)
│   ├── database.py               # SQLAlchemy async engine + session
│   ├── models/                   # ORM models
│   │   ├── user.py               #   User (auth)
│   │   ├── agent.py              #   Agent (Jason + sub-agents)
│   │   ├── mission.py            #   Mission + MissionDependency
│   │   └── chat.py               #   ChatSession + ChatMessage
│   ├── schemas/                  # Pydantic request/response schemas
│   ├── routers/                  # API route handlers
│   │   ├── auth.py               #   /api/auth/* (login, register, Google OAuth)
│   │   ├── agents.py             #   /api/agents/* (CRUD)
│   │   ├── missions.py           #   /api/missions/* (CRUD + status)
│   │   ├── chat.py               #   /api/chat/* (sessions, messages, WebSocket)
│   │   ├── deploy.py             #   /api/deploy/* (configure, launch, stop, logs, health)
│   │   ├── deploy_chat.py        #   /api/deploy-chat/* (connect/send to deployed containers)
│   │   ├── remote.py             #   /api/remote/* (remote OpenClaw connection management)
│   │   └── metrics.py            #   /api/metrics (system resource usage)
│   ├── services/                 # Business logic
│   │   ├── jason.py              #   Jason master orchestrator (task decomposition, sub-agent mgmt)
│   │   ├── sub_agent.py          #   Sub-agent executor (isolated task execution)
│   │   ├── llm_client.py         #   OpenRouter LLM client (httpx)
│   │   ├── remote_jason.py       #   RemoteJasonClient (OpenClaw WS protocol)
│   │   ├── remote_orchestrator.py#   RemoteJasonManager (connection lifecycle)
│   │   ├── deployer.py           #   Docker Compose deployer (one-click agent deployment)
│   │   ├── deployment_chat.py    #   DeploymentChatManager (chat with deployed containers)
│   │   ├── git_manager.py        #   Git worktree manager
│   │   ├── task_planner.py       #   LLM-based task decomposition
│   │   ├── discussion_writer.py  #   Mission discussion/progress writer
│   │   └── metrics.py            #   System metrics (psutil)
│   ├── websocket/                # WebSocket connection manager
│   ├── tests/                    # Pytest test suite
│   ├── requirements.txt          # Python dependencies
│   └── .env                      # Environment configuration
│
├── ui/                           # React frontend (Vite + TypeScript)
│   ├── src/
│   │   ├── App.tsx               # Root component (auth, routing, sidebar)
│   │   ├── api.ts                # API client (axios, all endpoint functions)
│   │   ├── main.tsx              # React entry point
│   │   ├── index.css             # Tailwind CSS base styles
│   │   ├── context/
│   │   │   └── MissionContext.tsx # Mission state provider
│   │   └── components/
│   │       ├── onboarding/       # Onboarding flow (5 phases)
│   │       │   ├── OnboardingFlow.tsx    # Phase orchestrator
│   │       │   ├── Visuals.tsx           # Animated left panel
│   │       │   ├── InstallationView.tsx  # Docker check + install
│   │       │   ├── ConfigForm.tsx        # API key + integration config
│   │       │   ├── DeploymentProgress.tsx# Real-time deploy logs + status
│   │       │   └── GoogleAuthButton.tsx  # OAuth button (lazy-loaded)
│   │       ├── Dashboard.tsx     # Mission board (kanban-style)
│   │       ├── Chat.tsx          # Agent Hub (chat interface)
│   │       ├── Agents.tsx        # Agent pool management
│   │       ├── DeployAgent.tsx   # Deploy Agent page (manual deploy)
│   │       ├── RemoteConfig.tsx  # Settings (remote OpenClaw config)
│   │       ├── Login.tsx         # Legacy username/password login
│   │       ├── CreateMissionModal.tsx # New mission dialog
│   │       └── ComingSoon.tsx    # Placeholder for upcoming features
│   ├── package.json
│   └── .env                      # Frontend env vars (VITE_*)
│
├── docker-compose.yml            # OpenClaw container definition (never modified)
├── .env.template                 # Classified env field template
├── Dockerfile                    # Multi-stage build for Aether itself
├── deploy.sh                     # CLI deployment script
├── configs/                      # Config templates (default, multi-agent)
├── deployments/                  # Runtime: per-deployment dirs (.env, compose, config, workspace)
├── electron/                     # Electron desktop app scaffold
├── context/                      # Design docs, bug fixes, feature docs
└── helper-function(s)/           # Debug/helper scripts
```

---

## Core Components

### 1. Authentication Layer

| Component | File | Description |
|-----------|------|-------------|
| JWT Auth | `api/routers/auth.py` | Username/password login, bcrypt hashing, JWT tokens |
| Google OAuth | `api/routers/auth.py` | Google ID token verification, auto-registration |
| Frontend Auth | `ui/src/App.tsx` | Token persistence in `localStorage`, onboarding flow gating |

**Flow**: Unauthenticated users see the `OnboardingFlow`. Authenticated users see the main sidebar UI. The `VITE_LEGACY_LOGIN=true` env var switches to the classic login form.

### 2. Jason Orchestrator (Local AI Agent)

| Component | File | Description |
|-----------|------|-------------|
| Jason Master | `api/services/jason.py` | Master AI agent — decomposes tasks, delegates to sub-agents |
| Sub-Agent Executor | `api/services/sub_agent.py` | Executes isolated tasks in git worktrees |
| Task Planner | `api/services/task_planner.py` | LLM-based task decomposition |
| LLM Client | `api/services/llm_client.py` | OpenRouter API client (httpx) |
| Git Manager | `api/services/git_manager.py` | Git worktree creation/cleanup for isolated work |

**Flow**: User creates a mission → Jason decomposes it into subtasks → Sub-agents execute in isolated worktrees → Results merged back.

### 3. Remote OpenClaw Connection

| Component | File | Description |
|-----------|------|-------------|
| RemoteJasonClient | `api/services/remote_jason.py` | Persistent WebSocket client for OpenClaw gateway |
| RemoteJasonManager | `api/services/remote_orchestrator.py` | Connection lifecycle, reconnection, event routing |
| Remote Router | `api/routers/remote.py` | REST API for managing remote connections |
| Chat Router | `api/routers/chat.py` | WebSocket bridge: browser ↔ backend ↔ OpenClaw |

**Protocol**: OpenClaw uses a JSON-RPC-over-WebSocket protocol with:
- `connect.challenge` → `connect` handshake (minProtocol, maxProtocol, client info, auth token)
- `req/res` frames for RPC calls (`chat.send`, `session.list`, etc.)
- `event` frames for real-time updates (`chat.message`, `agent.status`, etc.)

### 4. One-Click Agent Deployment

| Component | File | Description |
|-----------|------|-------------|
| Deployer Service | `api/services/deployer.py` | Generates .env, runs `docker compose up/down`, tracks deployments |
| Deploy Router | `api/routers/deploy.py` | REST endpoints: configure, launch, stop, status, logs, gateway-health |
| Deploy Chat | `api/services/deployment_chat.py` | Chat with locally deployed containers via WebSocket |
| Docker Compose | `docker-compose.yml` | Standard OpenClaw container definition (never modified) |
| CLI Deploy | `deploy.sh` | Interactive shell script for CLI-based deployment |

**Deployment Flow**:
1. **Configure**: Generate `.env` with auto PORT + TOKEN, user-provided API keys
2. **Launch**: `docker compose up -d --force-recreate` in isolated `deployments/<id>/` directory
3. **Health Check**: HTTP probe + WebSocket handshake to verify gateway is accessible
4. **Chat**: Connect via `RemoteJasonClient` with `client.id="cli"` for local containers

**Field Classification**:
- **AUTO**: `PORT` (random 10000–65000), `OPENCLAW_GATEWAY_TOKEN` (random hex)
- **MANDATORY**: `OPENROUTER_API_KEY`
- **OPTIONAL**: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `TELEGRAM_BOT_TOKEN` + `TELEGRAM_USER_ID`, `WHATSAPP_NUMBER`

### 5. Frontend UI

| Component | File | Description |
|-----------|------|-------------|
| Onboarding Flow | `ui/src/components/onboarding/` | 5-phase setup: Auth → Install → Config → Deploy → Complete |
| Mission Board | `ui/src/components/Dashboard.tsx` | Kanban-style mission management |
| Agent Hub | `ui/src/components/Chat.tsx` | Real-time chat with local/remote agents |
| Deploy Agent | `ui/src/components/DeployAgent.tsx` | Manual deployment management UI |
| Settings | `ui/src/components/RemoteConfig.tsx` | Remote OpenClaw connection configuration |
| Agents Pool | `ui/src/components/Agents.tsx` | Agent registry and management |

**Tech Stack**: React 19, TypeScript, Vite, Tailwind CSS v4, Framer Motion, Lucide icons, Axios.

---

## Data Flow

### Chat Message Flow (Remote OpenClaw)

```
Browser                    Backend                     OpenClaw Gateway
  │                          │                              │
  │── WebSocket connect ────>│                              │
  │                          │── WS connect (protocol v3) ─>│
  │                          │<── connect.challenge ────────│
  │                          │── connect (auth + client) ──>│
  │                          │<── connect.ok ───────────────│
  │                          │                              │
  │── chat.send (message) ──>│                              │
  │                          │── req: chat.send ───────────>│
  │                          │<── res: ok ─────────────────│
  │                          │<── event: chat.message ─────│
  │<── chat.message event ───│                              │
```

### Deployment Flow

```
Browser                    Backend                     Docker
  │                          │                           │
  │── POST /configure ──────>│                           │
  │                          │── generate .env ──────────│
  │                          │── copy docker-compose.yml │
  │<── {deployment_id} ──────│                           │
  │                          │                           │
  │── POST /launch ─────────>│                           │
  │                          │── docker compose down ───>│
  │                          │── docker compose up -d ──>│
  │<── {status: running} ────│                           │
  │                          │                           │
  │── GET /logs (poll) ─────>│                           │
  │                          │── docker compose logs ───>│
  │<── {lifecycle + container logs} ─│                   │
  │                          │                           │
  │── GET /gateway-health ──>│                           │
  │                          │── HTTP GET /?token=... ──>│ (container)
  │                          │── WS handshake ─────────>│ (container)
  │<── {healthy: true} ──────│                           │
```

---

## Database Schema

```
Users                    Agents                  Missions
┌──────────────┐        ┌──────────────┐        ┌──────────────────┐
│ id (UUID)    │        │ id (UUID)    │        │ id (UUID)        │
│ username     │        │ name         │        │ title            │
│ password_hash│        │ type         │        │ description      │
│ role         │        │ status       │        │ status           │
│ google_id    │        │ model        │        │ priority         │
│ email        │        │ capabilities │        │ assigned_agent_id│
│ created_at   │        │ created_at   │        │ created_at       │
└──────────────┘        └──────────────┘        │ updated_at       │
                                                 └──────────────────┘

ChatSessions             ChatMessages            MissionDependencies
┌──────────────┐        ┌──────────────┐        ┌──────────────────┐
│ id (UUID)    │        │ id (UUID)    │        │ mission_id       │
│ agent_id     │        │ session_id   │        │ depends_on_id    │
│ title        │        │ role         │        └──────────────────┘
│ created_at   │        │ content      │
└──────────────┘        │ model        │
                        │ created_at   │
                        └──────────────┘
```

---

## Key Design Decisions

1. **Single docker-compose.yml**: Never modified. All customization via `.env` file. The container's entrypoint shell script dynamically generates `openclaw.json` from environment variables.

2. **Configurable `client.id`**: The OpenClaw gateway requires specific `client.id` values. Local containers accept `"cli"`, remote gateways accept `"gateway-client"`. The `RemoteJasonClient` accepts a `gateway_client_id` parameter.

3. **Deployment isolation**: Each deployment gets its own directory under `deployments/<id>/` with its own `.env`, `docker-compose.yml`, `config/`, and `workspace/`.

4. **Lifecycle log buffer**: The deployer maintains an in-memory log buffer per deployment with timestamped STEP/INFO messages. These are merged with container runtime logs in `get_logs()`, with ANSI codes stripped and noisy warnings filtered.

5. **Two-phase deployment polling**: Frontend polls in two phases — Phase 1 polls container status (every 2s), Phase 2 polls gateway health (every 4s) — each with a 3-minute timeout.

6. **Dual auth modes**: Google OAuth (default) or legacy username/password (`VITE_LEGACY_LOGIN=true`). When no Google Client ID is configured, onboarding skips the auth phase entirely.
