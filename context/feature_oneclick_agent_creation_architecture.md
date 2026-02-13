# Feature: One-Click OpenClaw Agent Creation & Deployment Architecture

**Date:** 2026-02-10  
**Status:** Implementation Complete (All 3 Tiers Scaffolded)  
**Scope:** Agent creation via UI, VPS/Docker deployment, Electron app option

---

## 1. Research: emergent.sh Deep Dive

### 1.1 What is emergent.sh?

emergent.sh is a **SaaS vibe-coding platform** (Y Combinator S24, 3M+ users) that transforms natural language prompts into production-ready applications.

### 1.2 Key Architecture Patterns (Relevant to Us)

| Pattern | emergent.sh Implementation | Our Adaptation |
|---------|---------------------------|----------------|
| **One-click deployment** | Cloud-hosted, instant deploy from prompt | Docker Compose one-click on VPS |
| **Agent creation** | "Build Custom Agents" (Pro tier, $200/mo) | Free, self-hosted via OpenClaw config.patch RPC |
| **Integrated hosting** | Managed cloud infra | Self-hosted VPS or local Docker Desktop |
| **GitHub integration** | Standard tier ($20/mo) | Direct workspace mount in Docker |
| **LLM integration** | One-click model selection | OpenClaw model registry + OpenRouter |
| **Web-based UI** | React SPA, cloud-hosted | React SPA (Aether Orchestrator UI) |

### 1.3 emergent.sh Pricing & Feature Tiers

```
Free:     10 credits/mo, core features, web/mobile build
Standard: $20/mo — GitHub integration, private hosting, 100 credits
Pro:      $200/mo — Custom AI agents, 1M context, system prompt edit, 750 credits
```

### 1.4 What We Take From emergent.sh

- **Simplicity**: One form → one agent. No CLI knowledge needed.
- **Instant feedback**: Agent is live immediately after creation.
- **Integrated management**: Create, configure, monitor agents from one UI.
- **Template-based**: Pre-built agent templates for common use cases.

### 1.5 What We Do Differently

- **Self-hosted**: No SaaS dependency. User owns their infrastructure.
- **OpenClaw-native**: Agents run on OpenClaw gateway, not a proprietary runtime.
- **YAML-driven**: Deployment config is declarative YAML (user provides).
- **Multi-deployment**: Web UI, VPS/Docker, or Electron desktop app.

---

## 2. Research: OpenClaw Deployment & Agent Management

### 2.1 OpenClaw Docker Deployment (Hetzner VPS Guide)

**Commands to deploy OpenClaw on a VPS:**

```bash
# 1. SSH into VPS
ssh root@YOUR_VPS_IP

# 2. Install Docker
apt-get update
apt-get install -y git curl ca-certificates
curl -fsSL https://get.docker.com | sh

# 3. Verify Docker
docker --version
docker compose version

# 4. Clone OpenClaw
git clone https://github.com/openclaw/openclaw.git
cd openclaw

# 5. Create persistent directories
mkdir -p /root/.openclaw/workspace
chown -R 1000:1000 /root/.openclaw

# 6. Configure .env
cat > .env << 'EOF'
OPENCLAW_IMAGE=openclaw:latest
OPENCLAW_GATEWAY_TOKEN=<openssl rand -hex 32>
OPENCLAW_GATEWAY_BIND=lan
OPENCLAW_GATEWAY_PORT=18789
OPENCLAW_CONFIG_DIR=/root/.openclaw
OPENCLAW_WORKSPACE_DIR=/root/.openclaw/workspace
GOG_KEYRING_PASSWORD=<openssl rand -hex 32>
XDG_CONFIG_HOME=/home/node/.openclaw
EOF

# 7. Build and launch
docker compose build
docker compose up -d openclaw-gateway

# 8. Verify
docker compose logs -f openclaw-gateway
# Expected: [gateway] listening on ws://0.0.0.0:18789

# 9. Access via SSH tunnel (from laptop)
ssh -N -L 18789:127.0.0.1:18789 root@YOUR_VPS_IP
# Then open http://127.0.0.1:18789/
```

### 2.2 OpenClaw docker-compose.yml (Reference)

```yaml
services:
  openclaw-gateway:
    image: ${OPENCLAW_IMAGE}
    build: .
    restart: unless-stopped
    env_file:
      - .env
    environment:
      - HOME=/home/node
      - NODE_ENV=production
      - TERM=xterm-256color
      - OPENCLAW_GATEWAY_BIND=${OPENCLAW_GATEWAY_BIND}
      - OPENCLAW_GATEWAY_PORT=${OPENCLAW_GATEWAY_PORT}
      - OPENCLAW_GATEWAY_TOKEN=${OPENCLAW_GATEWAY_TOKEN}
      - GOG_KEYRING_PASSWORD=${GOG_KEYRING_PASSWORD}
      - XDG_CONFIG_HOME=${XDG_CONFIG_HOME}
      - PATH=/home/linuxbrew/.linuxbrew/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
    volumes:
      - ${OPENCLAW_CONFIG_DIR}:/home/node/.openclaw
      - ${OPENCLAW_WORKSPACE_DIR}:/home/node/.openclaw/workspace
    ports:
      - "127.0.0.1:${OPENCLAW_GATEWAY_PORT}:18789"
    command: [
      "node", "dist/index.js", "gateway",
      "--bind", "${OPENCLAW_GATEWAY_BIND}",
      "--port", "${OPENCLAW_GATEWAY_PORT}",
      "--allow-unconfigured",
    ]
```

### 2.3 OpenClaw Dockerfile (Reference)

```dockerfile
FROM node:22-bookworm
RUN apt-get update && apt-get install -y socat && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY ui/package.json ./ui/package.json
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
RUN pnpm ui:install
RUN pnpm ui:build
ENV NODE_ENV=production
CMD ["node","dist/index.js"]
```

### 2.4 OpenClaw Agent Creation Methods

#### Method A: CLI (`openclaw agents add`)

```bash
# Interactive
openclaw agents add work

# Non-interactive (scriptable)
openclaw agents add myagent \
  --workspace /path/to/workspace \
  --model "openrouter/anthropic/claude-sonnet-4" \
  --agent-dir /path/to/agent-dir \
  --bind telegram \
  --non-interactive \
  --json
```

**Output:** Creates agent entry in `openclaw.json` config, creates workspace and agent directories.

#### Method B: Gateway RPC (`config.patch`)

```bash
# 1. Get current config + hash
openclaw gateway call config.get --params '{}'
# Returns: { payload: { raw: "...", parsed: {...}, hash: "abc123" } }

# 2. Patch config to add new agent
openclaw gateway call config.patch --params '{
  "raw": "{ agents: { list: [ { id: \"myagent\", name: \"My Agent\", workspace: \"~/.openclaw/workspace-myagent\" } ] } }",
  "baseHash": "abc123",
  "restartDelayMs": 1000
}'
```

**Via WebSocket RPC (our backend uses this):**

```python
# Get config
result = await client.request("config.get")
config_hash = result["hash"]
parsed_config = result["parsed"]

# Add agent to agents.list
parsed_config["agents"]["list"].append({
    "id": "myagent",
    "name": "My Agent",
    "workspace": "~/.openclaw/workspace-myagent",
    "model": "openrouter/anthropic/claude-sonnet-4",
})

# Apply patched config
await client.request("config.patch", {
    "raw": json.dumps(parsed_config),
    "baseHash": config_hash,
    "restartDelayMs": 2000,
})
```

#### Method C: Direct Config Edit (`config.apply`)

Replaces the entire config. More dangerous but simpler for initial setup.

### 2.5 OpenClaw Multi-Agent Configuration

```json5
{
  agents: {
    defaults: {
      workspace: "~/.openclaw/workspace",
      model: { primary: "openrouter/anthropic/claude-sonnet-4" }
    },
    list: [
      {
        id: "main",
        name: "Main Agent",
        default: true,
        workspace: "~/.openclaw/workspace",
        subagents: { allowAgents: ["*"] }
      },
      {
        id: "researcher",
        name: "Researcher",
        workspace: "~/.openclaw/workspace-researcher",
        model: "openrouter/deepseek/deepseek-chat",
        identity: { name: "Researcher", emoji: "🔍" }
      },
      {
        id: "coder",
        name: "Coder",
        workspace: "~/.openclaw/workspace-coder",
        model: "openrouter/anthropic/claude-sonnet-4",
        identity: { name: "Coder", emoji: "💻" },
        sandbox: { mode: "all", workspaceAccess: "rw" }
      }
    ]
  }
}
```

### 2.6 Key OpenClaw Paths

| Path | Purpose |
|------|---------|
| `~/.openclaw/openclaw.json` | Main config file |
| `~/.openclaw/workspace` | Default agent workspace |
| `~/.openclaw/workspace-<agentId>` | Per-agent workspace |
| `~/.openclaw/agents/<agentId>/agent` | Agent state dir (auth, sessions) |
| `~/.openclaw/agents/<agentId>/sessions` | Chat history + routing state |

---

## 3. Architecture Design: Three Deployment Tiers

### 3.1 Tier 1: Web UI One-Click Agent Creation (Current Aether + Connected OpenClaw)

**How it works:**
1. User connects to an existing OpenClaw gateway from the Aether UI
2. User clicks "Create Agent" → fills in name, model, workspace
3. Backend calls `config.patch` RPC to add agent to `agents.list[]`
4. Gateway restarts, new agent is live

**Implementation:**
- Backend: `POST /api/remote/agents/create` → calls `config.patch`
- Backend: `config.patch` RPC method in `RemoteJasonClient`
- UI: "Create Agent" form in `RemoteConfig.tsx`

**Flow:**
```
User → Aether UI → POST /api/remote/agents/create
  → RemoteJasonClient.patch_config()
    → OpenClaw Gateway RPC: config.get (get hash)
    → OpenClaw Gateway RPC: config.patch (add agent to list)
    → Gateway restarts with new agent
  → Return success + new agent info
```

### 3.2 Tier 2: VPS/Docker One-Click Deployment

**How it works:**
1. User has a VPS (Hetzner, Vultr, DigitalOcean, etc.)
2. User runs a single deploy script OR uses a Docker Compose stack
3. Script installs Docker, clones repos, configures everything
4. Two services start: OpenClaw Gateway + Aether Orchestrator
5. User accesses Aether UI via browser, agents are pre-configured from YAML

**Docker Compose Stack:**
```yaml
services:
  # Service 1: OpenClaw Gateway (agent runtime)
  openclaw-gateway:
    image: openclaw:latest
    build:
      context: ./openclaw
    restart: unless-stopped
    environment:
      - OPENCLAW_GATEWAY_TOKEN=${GATEWAY_TOKEN}
      - OPENCLAW_GATEWAY_BIND=lan
      - OPENCLAW_GATEWAY_PORT=18789
    volumes:
      - openclaw-config:/home/node/.openclaw
      - openclaw-workspace:/home/node/.openclaw/workspace
    ports:
      - "127.0.0.1:18789:18789"

  # Service 2: Aether Orchestrator (management UI + API)
  aether-orchestrator:
    build:
      context: ./Agent-orchestrator
      dockerfile: Dockerfile
    restart: unless-stopped
    environment:
      - OPENCLAW_URL=ws://openclaw-gateway:18789
      - OPENCLAW_TOKEN=${GATEWAY_TOKEN}
      - OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
    ports:
      - "8080:8000"
    depends_on:
      - openclaw-gateway

volumes:
  openclaw-config:
  openclaw-workspace:
```

**One-click deploy script:**
```bash
#!/bin/bash
# deploy.sh — One-click Aether + OpenClaw deployment
set -e

echo "=== Aether Orchestrator + OpenClaw One-Click Deploy ==="

# 1. Install Docker if not present
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sh
fi

# 2. Clone repos
git clone https://github.com/openclaw/openclaw.git
git clone <aether-repo-url> Agent-orchestrator

# 3. Generate tokens
GATEWAY_TOKEN=$(openssl rand -hex 32)
echo "GATEWAY_TOKEN=$GATEWAY_TOKEN" > .env
echo "OPENROUTER_API_KEY=your-key-here" >> .env

# 4. Apply YAML configs (user-provided)
# cp agent-config-1.yaml openclaw/.openclaw/
# cp agent-config-2.yaml openclaw/.openclaw/

# 5. Build and launch
docker compose build
docker compose up -d

echo "=== Deployment Complete ==="
echo "Aether UI: http://$(hostname -I | awk '{print $1}'):8080"
echo "Gateway Token: $GATEWAY_TOKEN"
```

### 3.3 Tier 3: Electron Desktop App

**How it works:**
1. User downloads and installs the Electron app
2. App bundles Docker management (starts/stops containers locally)
3. Aether UI runs inside Electron window
4. OpenClaw Gateway runs in a local Docker container
5. Everything is local-first, no VPS needed

**Architecture:**
```
┌─────────────────────────────────────────┐
│           Electron App Shell            │
│  ┌───────────────────────────────────┐  │
│  │       Aether UI (React SPA)      │  │
│  │  - Agent creation form           │  │
│  │  - Chat interface                │  │
│  │  - Kanban board                  │  │
│  │  - Config management             │  │
│  └───────────────┬───────────────────┘  │
│                  │ HTTP/WS                │
│  ┌───────────────▼───────────────────┐  │
│  │    Aether API (FastAPI, port 8000)│  │
│  │  - Agent CRUD                    │  │
│  │  - Mission management            │  │
│  │  - Remote Jason client           │  │
│  └───────────────┬───────────────────┘  │
│                  │ WebSocket              │
│  ┌───────────────▼───────────────────┐  │
│  │  OpenClaw Gateway (Docker)       │  │
│  │  - Agent runtime                 │  │
│  │  - LLM integration              │  │
│  │  - Tool execution                │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

**Electron main process responsibilities:**
- Start/stop Docker containers for OpenClaw Gateway
- Start the Aether API server (Python/uvicorn)
- Load the Aether UI in a BrowserWindow
- Handle auto-updates
- Manage Docker Desktop dependency

**Tech stack:**
```
electron + electron-builder    — App shell + packaging
@electron/remote               — IPC between main/renderer
dockerode                      — Docker API client for Node.js
child_process                  — Spawn Python API server
```

---

## 4. Implementation Plan

### Phase 1: Web UI One-Click Agent Creation (Immediate)

**Step 1:** Add `config.patch` RPC method to `RemoteJasonClient`
- File: `api/services/remote_jason.py`
- Method: `patch_config(raw: str, config_hash: str) -> dict`

**Step 2:** Add `POST /api/remote/agents/create` endpoint
- File: `api/routers/remote.py`
- Flow: get config → add agent to list → patch config → return

**Step 3:** Add "Create Agent" UI form
- File: `ui/src/components/RemoteConfig.tsx`
- Fields: Agent ID, Name, Model, Workspace path
- Button: "Create Agent" → calls backend

### Phase 2: Docker Compose Stack (After user provides YAMLs)

**Step 1:** Create `Dockerfile` for Aether Orchestrator
**Step 2:** Create `docker-compose.yml` with both services
**Step 3:** Create `deploy.sh` one-click script
**Step 4:** Integrate user-provided YAML configs

### Phase 3: Electron App (Future)

**Step 1:** Initialize Electron project wrapping the UI
**Step 2:** Add Docker management via `dockerode`
**Step 3:** Package for Linux/macOS/Windows
**Step 4:** Auto-update mechanism

---

## 5. Current Aether Orchestrator Architecture

### 5.1 Existing Components

| Component | Path | Purpose |
|-----------|------|---------|
| **API Server** | `api/main.py` | FastAPI backend, port 8000 |
| **Agent Router** | `api/routers/agents.py` | Local agent CRUD |
| **Remote Router** | `api/routers/remote.py` | OpenClaw gateway proxy |
| **Remote Jason Client** | `api/services/remote_jason.py` | WebSocket client to OpenClaw |
| **Remote Orchestrator** | `api/services/remote_orchestrator.py` | @jason mention handling |
| **Jason Orchestrator** | `api/services/jason.py` | Local agent orchestration |
| **UI** | `ui/src/` | React SPA with Vite |
| **RemoteConfig** | `ui/src/components/RemoteConfig.tsx` | Connection + config UI |

### 5.2 Existing RPC Methods in RemoteJasonClient

| Method | RPC Call | Purpose |
|--------|----------|---------|
| `get_config()` | `config.get` | Get full config + hash |
| `set_config()` | `config.set` | Replace entire config |
| `get_agents()` | `agents.list` | List agents |
| `get_sessions()` | `sessions.list` | List sessions |
| `get_models()` | `models.list` | List models |
| `get_agent_files()` | `agents.files.list` | List persona files |
| `get_agent_file()` | `agents.files.get` | Read persona file |
| `set_agent_file()` | `agents.files.set` | Write persona file |
| `chat_send()` | `chat.send` | Send message |
| `chat_history()` | `chat.history` | Get chat history |
| `chat_abort()` | `chat.abort` | Abort generation |
| `get_status()` | `status` | Gateway status |
| `get_health()` | `health` | Gateway health |

### 5.3 Missing RPC Methods (To Be Added)

| Method | RPC Call | Purpose |
|--------|----------|---------|
| `patch_config()` | `config.patch` | Partial config update (add agent) |

---

## 6. Files to Create/Modify

### Phase 1 (Web UI Agent Creation)

| File | Action | Change |
|------|--------|--------|
| `api/services/remote_jason.py` | Modify | Add `patch_config()` method |
| `api/routers/remote.py` | Modify | Add `POST /api/remote/agents/create` endpoint |
| `ui/src/api.ts` | Modify | Add `createRemoteAgent()` function |
| `ui/src/components/RemoteConfig.tsx` | Modify | Add "Create Agent" form section |

### Phase 2 (Docker Compose Stack)

| File | Action | Change |
|------|--------|--------|
| `Dockerfile` | Create | Aether Orchestrator container |
| `docker-compose.yml` | Create | Full stack (OpenClaw + Aether) |
| `deploy.sh` | Create | One-click deploy script |
| `.env.template` | Create | Environment variable template |

### Phase 3 (Electron App)

| File | Action | Change |
|------|--------|--------|
| `electron/` | Create | Electron app directory |
| `electron/main.js` | Create | Electron main process |
| `electron/preload.js` | Create | Preload script |
| `electron/package.json` | Create | Electron dependencies |
| `electron/docker-manager.js` | Create | Docker container management |

---

## 7. Comparison: Deployment Options

| Feature | Web UI (Tier 1) | VPS/Docker (Tier 2) | Electron (Tier 3) |
|---------|----------------|--------------------|--------------------|
| **Setup time** | 0 (already connected) | ~20 min | ~5 min (download + install) |
| **Requires VPS** | Yes (existing) | Yes (new or existing) | No |
| **Requires Docker** | No (on client) | Yes (on VPS) | Yes (Docker Desktop) |
| **Agent creation** | One-click via UI | Pre-configured from YAML | One-click via UI |
| **Persistence** | OpenClaw gateway | Docker volumes | Local Docker volumes |
| **Scalability** | Limited by VPS | VPS resources | Local machine |
| **Best for** | Existing users | New deployments | Desktop users |
| **YAML support** | Via config.patch | Direct mount | Via config.patch |

---

## 8. Implementation Summary — All Files Created/Modified

### Modified Files (Tier 1: Web UI Agent Creation)

| File | Changes |
|------|---------|
| `api/services/remote_jason.py` | Added `patch_config()` RPC method and `create_agent()` high-level method that fetches config, appends agent to `agents.list[]`, patches config, triggers gateway restart |
| `api/routers/remote.py` | Added `CreateAgentRequest` Pydantic model and `POST /api/remote/agents/create` endpoint with duplicate detection (409) and error handling |
| `ui/src/api.ts` | Added `CreateAgentRequest` interface and `createRemoteAgent()` API function |
| `ui/src/components/RemoteConfig.tsx` | Added "Create New Agent" section (Section 4) with form fields (Agent ID, Name, Model, Emoji), create handler, existing agents list display |

### New Files (Tier 2: VPS/Docker One-Click Deploy)

| File | Purpose |
|------|---------|
| `Dockerfile` | Multi-stage build: Stage 1 builds React UI with Node 22, Stage 2 runs FastAPI with Python 3.12-slim, serves built UI |
| `docker-compose.yml` | Two-service stack: `openclaw-gateway` (agent runtime with health check) + `aether-orchestrator` (management UI/API), connected via `aether-net` bridge network |
| `deploy.sh` | One-click VPS deploy script: installs Docker, generates secure tokens, creates `.env`, builds images, starts services, prints access URLs |
| `.env.template` | Environment variable template with placeholders for gateway token, keyring password, OpenRouter API key |

### New Files (Tier 3: Electron Desktop App)

| File | Purpose |
|------|---------|
| `electron/package.json` | Electron + electron-builder config with cross-platform build targets (AppImage, deb, dmg, nsis) |
| `electron/main.js` | Main process: BrowserWindow management, IPC handlers for Docker ops, settings store, auto-start containers |
| `electron/preload.js` | contextBridge API exposing `window.aether.docker.*`, `window.aether.settings.*`, `window.aether.openExternal()` |
| `electron/docker-manager.js` | Docker management via `dockerode`: start/stop compose stack, container health checks, log streaming, first-run file provisioning |
| `electron/assets/loading.html` | Styled loading screen shown while Docker containers start |

### New Files (Config Templates)

| File | Purpose |
|------|---------|
| `configs/openclaw-default.json` | Single-agent config template (Jason only) |
| `configs/openclaw-multi-agent.json` | Multi-agent team template (Jason + Researcher + Coder + Reviewer) |
| `configs/README.md` | Usage docs for config templates (Docker mount, Web UI, CLI methods) |

### Documentation

| File | Purpose |
|------|---------|
| `context/feature_oneclick_agent_creation_architecture.md` | This file — full research, design, and implementation docs |

---

## 9. Verification & Testing

### Tier 1: Web UI Agent Creation

```bash
# 1. Start the Aether API
cd api && uvicorn main:app --reload --port 8000

# 2. Start the UI
cd ui && npm run dev

# 3. Connect to an OpenClaw gateway from the Remote Config page

# 4. Expand "Create New Agent" section
# 5. Fill in: Agent ID = "researcher", Name = "Research Agent", Model = (optional)
# 6. Click "Create Agent"
# 7. Verify: toast shows success, existing agents list updates, gateway restarts

# API test (curl):
curl -X POST http://localhost:8000/api/remote/agents/create \
  -H "Content-Type: application/json" \
  -d '{"agent_id": "researcher", "name": "Research Agent", "model": "openrouter/deepseek/deepseek-chat"}'
```

### Tier 2: VPS/Docker Deploy

```bash
# On a fresh VPS:
chmod +x deploy.sh
./deploy.sh

# Or manually:
cp .env.template .env
# Edit .env with your tokens
docker compose up -d
docker compose logs -f
```

### Tier 3: Electron App

```bash
cd electron
npm install
npm start
# App opens, loads Aether UI, manages Docker containers via IPC
```

---

## 10. Simplified Deployment Design (Final — Feb 10)

### Core Principle

**One standard YAML + one .env file.** The YAML is never modified. All customization happens through the `.env` file, which is generated from customer input via the UI or CLI.

### How It Works

```
Customer Input (UI form or CLI prompts)
        │
        ▼
┌─────────────────────────┐
│  Generate .env file     │  ← PORT (random), TOKEN (random), user keys
│  from field values      │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  docker compose up -d   │  ← Uses standard docker-compose.yml + generated .env
│  (standard YAML)        │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  Container starts       │  ← Shell script in YAML dynamically builds
│  openclaw.json built    │     openclaw.json based on which env vars are set
│  Gateway launches       │
└─────────────────────────┘
```

### Field Classification

| Field | Type | Description | Default/Generation |
|-------|------|-------------|-------------------|
| `PORT` | AUTO | Gateway port | Random 10000-65000 |
| `OPENCLAW_GATEWAY_TOKEN` | AUTO | Auth token | `openssl rand -hex 16` |
| `OPENROUTER_API_KEY` | MANDATORY | LLM access | User provides |
| `ANTHROPIC_API_KEY` | OPTIONAL | Claude fallback | Blank = skipped |
| `OPENAI_API_KEY` | OPTIONAL | GPT fallback | Blank = skipped |
| `TELEGRAM_BOT_TOKEN` | OPTIONAL | Telegram bot | Blank = skipped |
| `TELEGRAM_USER_ID` | OPTIONAL* | Telegram user | *Required if bot token set |
| `WHATSAPP_NUMBER` | OPTIONAL | WhatsApp chat | Blank = skipped |

### New Backend: Deploy Service

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/deploy/schema` | GET | Returns field schema for UI form rendering |
| `/api/deploy/configure` | POST | Generates .env + deployment dir from customer input |
| `/api/deploy/launch` | POST | Runs `docker compose up -d` for a configured deployment |
| `/api/deploy/stop` | POST | Runs `docker compose down` |
| `/api/deploy/status/{id}` | GET | Container status via `docker compose ps` |
| `/api/deploy/logs/{id}` | GET | Container logs via `docker compose logs` |
| `/api/deploy/list` | GET | List all tracked deployments |

**Files:**
- `api/services/deployer.py` — Deployer service class (env generation, docker compose lifecycle)
- `api/routers/deploy.py` — FastAPI router with all endpoints above

### New Frontend: Deploy Agent Page

- `ui/src/components/DeployAgent.tsx` — Full deploy UI
- Sidebar nav: "Deploy Agent" with Rocket icon
- Sections: LLM Configuration (required), Telegram (optional), WhatsApp (optional)
- One-click "Deploy Agent" button → configure + launch in sequence
- Result panel: deployment ID, port, token (copyable), connect URL
- Logs viewer, stop button, active deployments list

### Deployment Directory Structure

```
deployments/
  <deployment-id>/
    .env                    ← Generated from customer input
    docker-compose.yml      ← Copied from project root (standard)
    config/                 ← Mounted as /home/node/.openclaw
    workspace/              ← Mounted as /home/node/.openclaw/workspace
```

---

## 11. Next Steps

1. **Test end-to-end** — Deploy via the UI on a machine with Docker installed
2. **Test CLI deploy** — Run `./deploy.sh` on a VPS
3. **Electron packaging** — `cd electron && npm run build` for desktop app
4. **Persistence** — Add SQLite storage for deployment records (currently in-memory)
5. **Multi-deployment** — Support multiple concurrent agent deployments on different ports
