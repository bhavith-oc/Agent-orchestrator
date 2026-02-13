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

### 4. VPS / Production Setup

For VPS deployment with a custom domain, SSL, and Nginx reverse proxy:

```bash
# Run the automated setup script
bash setup.sh
```

This configures:
- **Nginx** reverse proxy (port 80/443)
- **Let's Encrypt** SSL via Certbot (auto-renewing)
- **systemd** services for auto-restart on reboot
- **Landing page** at `https://your-domain/`
- **Platform** at `https://your-domain/app`
- **API** at `https://your-domain/api/`
- **Docs** at `https://your-domain/docs.html`

### 5. Deploy an Agent

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
| `CORS_ORIGINS` | No | Comma-separated allowed origins (e.g. `https://agent.virtualgpt.org`) |
| `REMOTE_JASON_URL` | No | Remote OpenClaw WebSocket URL |
| `REMOTE_JASON_TOKEN` | No | Remote OpenClaw gateway token |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID |

### Frontend (`ui/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_GOOGLE_CLIENT_ID` | No | Google OAuth client ID |
| `VITE_API_URL` | No | Backend API URL (e.g. `https://agent.virtualgpt.org/api`) |
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

## URL Structure (Production)

| URL | Description |
|-----|-------------|
| `https://agent.virtualgpt.org/` | Landing page with docs and "Try the Platform" CTA |
| `https://agent.virtualgpt.org/app` | Main platform (onboarding → dashboard) |
| `https://agent.virtualgpt.org/docs.html` | Full technical documentation |
| `https://agent.virtualgpt.org/api/` | Backend API (proxied via Nginx) |
| `https://agent.virtualgpt.org/api/docs` | FastAPI auto-generated Swagger docs |

---

## Telegram Integration

When deploying an agent with Telegram credentials:

1. Provide `TELEGRAM_BOT_TOKEN` (from @BotFather) and `TELEGRAM_USER_ID`
2. The docker-compose template auto-generates `openclaw.json` with:
   - `channels.telegram` config (botToken, allowFrom, dmPolicy)
   - `plugins.entries.telegram.enabled: true` (auto-enabled by OpenClaw)
3. On container start, OpenClaw runs its "doctor" which auto-enables the Telegram plugin
4. The `[telegram] starting provider` log confirms successful connection

> **Note:** The initial log message "Telegram configured, not enabled yet" is normal — OpenClaw auto-enables it during startup.

---

## Infrastructure

### systemd Services

| Service | Description | Command |
|---------|-------------|--------|
| `aether-backend` | FastAPI on port 8000 | `systemctl restart aether-backend` |
| `aether-frontend` | Vite on port 5173 | `systemctl restart aether-frontend` |
| `nginx` | Reverse proxy + SSL | `systemctl reload nginx` |

### Nginx Config

Location: `/etc/nginx/sites-available/agent.virtualgpt.org`

- `= /` → Landing page (`landing.html`)
- `/app` → React app (Vite dev server)
- `/api/` → FastAPI backend
- SSL via Let's Encrypt (auto-renew via Certbot timer)

---

## License

Proprietary — One Convergence Devices.
