# Aether Orchestrator — Setup Guide

Complete installation and configuration instructions for running Aether Orchestrator locally.

---

## Prerequisites

| Requirement | Version | Check Command |
|-------------|---------|---------------|
| Python | 3.12+ | `python3 --version` |
| Node.js | 18+ | `node --version` |
| npm | 9+ | `npm --version` |
| Docker | 24+ | `docker --version` |
| Docker Compose | v2+ | `docker compose version` |

### Install Docker (if not present)

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2
sudo usermod -aG docker $USER
# Log out and back in for group changes to take effect
```

### Get an OpenRouter API Key

1. Go to [openrouter.ai](https://openrouter.ai)
2. Sign up / log in
3. Navigate to **Keys** → **Create Key**
4. Copy the key (starts with `sk-or-v1-...`)

---

## Step 1: Clone the Repository

```bash
git clone <repo-url> Agent-orchestrator
cd Agent-orchestrator
```

---

## Step 2: Backend Setup

### 2.1 Create Python Virtual Environment

```bash
cd api
python3 -m venv venv
source venv/bin/activate
```

### 2.2 Install Dependencies

```bash
pip install -r requirements.txt
```

**Dependencies installed**:
- `fastapi` — Web framework
- `uvicorn` — ASGI server
- `sqlalchemy` + `aiosqlite` — Async ORM + SQLite
- `pydantic` + `pydantic-settings` — Data validation + env config
- `python-jose` + `bcrypt` — JWT auth + password hashing
- `httpx` — Async HTTP client (for OpenRouter API)
- `websockets` — WebSocket client (for OpenClaw protocol)
- `psutil` — System metrics
- `pyyaml` — YAML parsing

### 2.3 Configure Environment

Edit `api/.env`:

```bash
# Required — your OpenRouter API key
OPENROUTER_API_KEY=sk-or-v1-your-key-here

# Server (defaults are fine for local dev)
HOST=0.0.0.0
PORT=8000
SECRET_KEY=change-this-in-production

# Database (SQLite, auto-created)
DATABASE_URL=sqlite+aiosqlite:///./aether.db

# Jason LLM Config
JASON_MODEL=openai/gpt-4o
JASON_TEMPERATURE=0.3
JASON_MAX_TOKENS=4096

# Sub-Agent Config
SUB_AGENT_MODEL=openai/gpt-4o-mini
SUB_AGENT_TEMPERATURE=0.2
SUB_AGENT_MAX_TOKENS=8192

# Remote OpenClaw (optional — auto-connects on startup if set)
REMOTE_JASON_URL=
REMOTE_JASON_TOKEN=
REMOTE_JASON_SESSION=agent:main:main

# Google OAuth (optional)
GOOGLE_CLIENT_ID=
```

### 2.4 Start the Backend

```bash
# From api/ directory, with venv activated
python3 main.py
```

**Expected output**:
```
INFO:     Started server process [12345]
INFO:     Waiting for application startup.
[INFO] __main__: Initializing Aether Orchestrator...
[INFO] __main__: Database initialized.
[INFO] __main__: Jason master agent ready (id=abc123)
[INFO] __main__: Default admin user created (admin / Oc123)
[INFO] __main__: Aether Orchestrator is live.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
```

**Default admin credentials**: `admin` / `Oc123`

### 2.5 Verify Backend

```bash
curl http://localhost:8000/api/health
# {"status":"ok","service":"Aether Orchestrator"}
```

---

## Step 3: Frontend Setup

### 3.1 Install Dependencies

```bash
cd ui
npm install
```

### 3.2 Configure Environment

Edit `ui/.env`:

```bash
# Google OAuth (leave blank to skip Google auth in onboarding)
VITE_GOOGLE_CLIENT_ID=

# Set to 'true' to use legacy username/password login
VITE_LEGACY_LOGIN=false
```

### 3.3 Start the Dev Server

```bash
npm run dev
```

**Expected output**:
```
  VITE v5.4.15  ready in 500ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.x.x:5173/
```

### 3.4 Open the UI

Navigate to `http://localhost:5173` in your browser.

- **Without Google OAuth configured**: You'll see the onboarding flow starting at the Installation check phase.
- **With `VITE_LEGACY_LOGIN=true`**: You'll see the classic login form. Use `admin` / `Oc123`.

---

## Step 4: Deploy an Agent (One-Click)

### Via the UI (Recommended)

1. Open `http://localhost:5173`
2. Follow the onboarding flow:
   - **Installation**: Verifies Docker is available
   - **Configuration**: Enter your OpenRouter API key (and optionally Anthropic/OpenAI keys, Telegram bot token)
   - **Deploying**: Watch real-time deployment logs with step-by-step progress
   - **Complete**: Agent is online — click "Open Chat Session"

### Via the CLI

```bash
./deploy.sh
```

The script will:
1. Check Docker availability
2. Auto-generate a random port and gateway token
3. Prompt for your API keys
4. Write `.env` and run `docker compose up -d`

### Via the API (curl)

```bash
# 1. Configure
curl -X POST http://localhost:8000/api/deploy/configure \
  -H "Content-Type: application/json" \
  -d '{"openrouter_api_key": "sk-or-v1-your-key"}'
# Returns: {"deployment_id": "abc123", "port": 45678, "gateway_token": "..."}

# 2. Launch
curl -X POST http://localhost:8000/api/deploy/launch/abc123

# 3. Check status
curl http://localhost:8000/api/deploy/status/abc123

# 4. Check gateway health
curl http://localhost:8000/api/deploy/gateway-health/abc123

# 5. View logs
curl http://localhost:8000/api/deploy/logs/abc123?tail=50
```

---

## Step 5: Connect to a Remote OpenClaw Gateway (Optional)

If you have an existing OpenClaw instance running elsewhere:

### Via the UI

1. Navigate to **Settings** (gear icon in sidebar)
2. Enter the WebSocket URL (e.g., `ws://your-server:61816`)
3. Enter the gateway token
4. Click **Connect**

### Via Environment Variables

Set in `api/.env` before starting the backend:

```bash
REMOTE_JASON_URL=ws://your-server:61816
REMOTE_JASON_TOKEN=your-gateway-token
REMOTE_JASON_SESSION=agent:main:main
```

The backend will auto-connect on startup.

### Via the API

```bash
curl -X POST http://localhost:8000/api/remote/connect \
  -H "Content-Type: application/json" \
  -d '{"url": "ws://your-server:61816", "token": "your-token"}'
```

---

## Google OAuth Setup (Optional)

To enable Google Sign-In:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or select existing)
3. Navigate to **APIs & Services** → **Credentials**
4. Click **Create Credentials** → **OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Add authorized JavaScript origins: `http://localhost:5173`
7. Copy the **Client ID**

Set in both:
- `api/.env`: `GOOGLE_CLIENT_ID=your-client-id`
- `ui/.env`: `VITE_GOOGLE_CLIENT_ID=your-client-id`

Restart both servers.

---

## Development Tips

### Browser Debug Flags

Skip auth and jump straight to the main UI from the browser console:

```js
window.__AETHER_SKIP_AUTH__ = true; location.reload()
```

Navigate to any tab:
```js
window.__AETHER_NAV__('deploy')   // deploy, dashboard, hub, agents, metrics, settings
```

See [context/debug_browser_flags.md](./context/debug_browser_flags.md) for all flags.

### Running Tests

```bash
cd api
source venv/bin/activate
pytest
```

### Building for Production

```bash
# Build the UI
cd ui && npm run build

# Build Docker image
docker build -t aether-orchestrator .

# Run
docker run -p 8000:8000 --env-file api/.env aether-orchestrator
```

---

## Troubleshooting

### Backend won't start

- **Port 8000 in use**: `lsof -i :8000` to find the process, `kill <pid>` to free it
- **Missing dependencies**: `pip install -r requirements.txt` in the venv
- **Database locked**: Delete `api/aether.db` and restart (it auto-recreates)

### Docker deployment fails

- **Docker not running**: `sudo systemctl start docker`
- **Permission denied**: `sudo usermod -aG docker $USER` then log out/in
- **Port conflict**: The deployer auto-generates random ports (10000–65000), but check with `ss -tlnp | grep <port>`

### Gateway health check fails

- **Container not ready**: Wait 30–60 seconds after launch for the OpenClaw gateway to initialize
- **Wrong client.id**: Local containers require `client.id="cli"` (already configured in the codebase)
- **Token mismatch**: Verify the gateway token matches between `.env` and the health check URL

### Frontend build errors

- **Node version**: Ensure Node.js 18+ (`node --version`)
- **Clean install**: `rm -rf node_modules && npm install`
- **Vite cache**: `rm -rf node_modules/.vite && npm run dev`

### CORS errors

The backend allows origins: `localhost:5173`, `localhost:5174`, `localhost:5175`, `localhost:3000`, `localhost:8080`. If your frontend runs on a different port, add it to `api/main.py` origins list.
