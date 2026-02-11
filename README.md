# Aether Orchestrator

> Deploy, manage, and chat with autonomous AI agents — powered by OpenClaw.

Aether Orchestrator is a full-stack platform that provides one-click deployment of AI agents via Docker, real-time chat through WebSocket, mission management with task decomposition, and a modern React dashboard — all backed by a FastAPI server.

---

## Features

- **One-Click Agent Deployment** — Deploy OpenClaw AI agents with a single click. Auto-generates ports, tokens, and config. Supports OpenRouter, Anthropic, OpenAI, Telegram, and WhatsApp integrations.
- **Real-Time Agent Chat** — WebSocket-based chat with both locally deployed and remote OpenClaw agents. Supports the full OpenClaw JSON-RPC protocol (v3).
- **Mission Board** — Create, track, and manage missions with priority levels and status tracking. Jason (master agent) decomposes complex tasks into subtasks.
- **Agent Pool** — Registry of AI agents with capabilities, status, and model configuration.
- **Remote OpenClaw Connection** — Connect to remote OpenClaw gateways (including Cloudflare Access-protected instances) for distributed agent management.
- **Onboarding Flow** — Guided 5-phase setup: Authentication → Docker Check → Configuration → Deployment → Ready.
- **System Metrics** — Real-time CPU, memory, and disk usage monitoring.
- **CLI Deploy** — Interactive shell script (`deploy.sh`) for terminal-based deployment.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19, TypeScript, Vite, Tailwind CSS v4, Framer Motion, Lucide Icons |
| **Backend** | Python 3.12, FastAPI, SQLAlchemy (async), Pydantic v2 |
| **Database** | SQLite (aiosqlite) |
| **Auth** | JWT (python-jose), bcrypt, Google OAuth |
| **Deployment** | Docker Compose, OpenClaw container |
| **LLM** | OpenRouter API (supports GPT-4o, Claude, Grok, etc.) |
| **Protocol** | OpenClaw JSON-RPC over WebSocket (protocol v3) |
| **Desktop** | Electron (scaffold) |

---

## Quick Start

### Prerequisites

- **Python 3.12+**
- **Node.js 18+** (for UI)
- **Docker** with Docker Compose v2
- An **OpenRouter API key** (get one at [openrouter.ai](https://openrouter.ai))

### 1. Clone and Setup

```bash
git clone <repo-url> Agent-orchestrator
cd Agent-orchestrator
```

### 2. Backend

```bash
cd api
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # or edit .env directly
# Set your OPENROUTER_API_KEY in .env
python3 main.py
```

Backend runs at `http://localhost:8000`.

### 3. Frontend

```bash
cd ui
npm install
npm run dev
```

Frontend runs at `http://localhost:5173`.

### 4. Deploy an Agent

Open the UI → follow the onboarding flow → enter your API key → click Deploy. The system will:
1. Generate a unique port and gateway token
2. Pull the OpenClaw Docker image
3. Start the container with your configuration
4. Verify gateway health via HTTP + WebSocket
5. Connect you to the agent chat

> See [SETUP.md](./SETUP.md) for detailed installation instructions.

---

## Project Structure

```
Agent-orchestrator/
├── api/                    # FastAPI backend (Python)
│   ├── main.py             # Entry point
│   ├── config.py           # Environment-based settings
│   ├── models/             # SQLAlchemy ORM models
│   ├── routers/            # API route handlers
│   ├── services/           # Business logic
│   └── websocket/          # WebSocket manager
├── ui/                     # React frontend (TypeScript)
│   ├── src/
│   │   ├── App.tsx         # Root component
│   │   ├── api.ts          # API client
│   │   └── components/     # UI components
│   └── package.json
├── docker-compose.yml      # OpenClaw container definition
├── deploy.sh               # CLI deployment script
├── Dockerfile              # Multi-stage build for Aether itself
├── configs/                # Config templates
├── deployments/            # Runtime deployment directories
├── context/                # Design docs, bug fixes, feature docs
└── electron/               # Desktop app scaffold
```

> See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed system architecture.

---

## API Endpoints

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Username/password login |
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/google` | Google OAuth login |

### Missions
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/missions` | List all missions |
| POST | `/api/missions` | Create a mission |
| PATCH | `/api/missions/{id}` | Update mission status |

### Chat
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/chat/sessions` | List chat sessions |
| POST | `/api/chat/sessions` | Create a session |
| WS | `/api/chat/ws/{session_id}` | WebSocket chat |

### Deploy
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/deploy/schema` | Get deployment field schema |
| POST | `/api/deploy/configure` | Configure a new deployment |
| POST | `/api/deploy/launch/{id}` | Launch a configured deployment |
| POST | `/api/deploy/stop/{id}` | Stop a running deployment |
| GET | `/api/deploy/status/{id}` | Get container status |
| GET | `/api/deploy/logs/{id}` | Get deployment + container logs |
| GET | `/api/deploy/gateway-health/{id}` | Check gateway HTTP + WS health |
| GET | `/api/deploy/list` | List all deployments |

### Remote
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/remote/connect` | Connect to remote OpenClaw |
| POST | `/api/remote/disconnect` | Disconnect |
| GET | `/api/remote/status` | Connection status |
| POST | `/api/remote/send` | Send message to remote agent |

### Deploy Chat
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/deploy-chat/connect` | Connect to deployed container |
| POST | `/api/deploy-chat/send` | Send message to deployed agent |
| POST | `/api/deploy-chat/disconnect` | Disconnect from container |

---

## Browser Debug Flags

For development, you can control the UI from the browser DevTools console:

```js
// Skip auth and show main UI immediately
window.__AETHER_SKIP_AUTH__ = true; location.reload()

// Navigate to a specific tab
window.__AETHER_NAV__('deploy')   // deploy, dashboard, hub, agents, metrics, settings

// Force show onboarding flow
window.__AETHER_SHOW_ONBOARDING__ = true; location.reload()

// Force logout
window.__AETHER_LOGOUT__()
```

> See [context/debug_browser_flags.md](./context/debug_browser_flags.md) for full documentation.

---

## Environment Variables

### Backend (`api/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENROUTER_API_KEY` | Yes | OpenRouter API key for LLM access |
| `SECRET_KEY` | Yes | JWT signing secret (change in production) |
| `REMOTE_JASON_URL` | No | Remote OpenClaw WebSocket URL |
| `REMOTE_JASON_TOKEN` | No | Remote OpenClaw gateway token |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID |

### Frontend (`ui/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_GOOGLE_CLIENT_ID` | No | Google OAuth client ID |
| `VITE_LEGACY_LOGIN` | No | Set `true` for username/password login |

---

## Documentation

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture, components, data flow |
| [SETUP.md](./SETUP.md) | Detailed installation and configuration guide |
| [ROADMAP.md](./ROADMAP.md) | Current state, planned features, milestones |
| [context/](./context/) | Design documents, bug fixes, feature documentation |

---

## License

Proprietary — One Convergence Devices.
