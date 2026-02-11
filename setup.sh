#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# Aether Orchestrator — Full Setup & Launch Script
# Works on Ubuntu/Debian VPS or local Linux machines.
#
# What this script does:
#   1. Installs system dependencies (Python 3.12+, Node 22, Docker)
#   2. Creates Python venv & installs backend dependencies
#   3. Installs frontend npm packages
#   4. Generates .env files from templates (prompts for API keys)
#   5. Starts the backend API server (port 8000)
#   6. Builds & starts the frontend dev server (port 5173)
#
# Usage:
#   chmod +x setup.sh
#   ./setup.sh              # Interactive setup + start
#   ./setup.sh --start      # Skip install, just start services
#   ./setup.sh --install    # Install only, don't start
#   ./setup.sh --stop       # Stop running services
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Colors ───────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }
step()    { echo -e "\n${BOLD}═══ $* ═══${NC}"; }

# ── Paths ────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$SCRIPT_DIR/api"
UI_DIR="$SCRIPT_DIR/ui"
VENV_DIR="$API_DIR/venv"
PID_DIR="$SCRIPT_DIR/.pids"

mkdir -p "$PID_DIR"

# ── Detect VPS IP ────────────────────────────────────────────────
get_public_ip() {
    curl -s --max-time 5 ifconfig.me 2>/dev/null || \
    curl -s --max-time 5 icanhazip.com 2>/dev/null || \
    hostname -I 2>/dev/null | awk '{print $1}' || \
    echo "localhost"
}

# ═════════════════════════════════════════════════════════════════
# STOP — kill running services
# ═════════════════════════════════════════════════════════════════
do_stop() {
    step "Stopping Aether Orchestrator services"

    if [ -f "$PID_DIR/backend.pid" ]; then
        PID=$(cat "$PID_DIR/backend.pid")
        if kill -0 "$PID" 2>/dev/null; then
            kill "$PID" && success "Backend stopped (PID $PID)"
        else
            warn "Backend PID $PID not running"
        fi
        rm -f "$PID_DIR/backend.pid"
    else
        # Try to find by port
        PID=$(lsof -ti:8000 2>/dev/null || true)
        if [ -n "$PID" ]; then
            kill "$PID" 2>/dev/null && success "Backend stopped (PID $PID)"
        else
            info "No backend process found"
        fi
    fi

    if [ -f "$PID_DIR/frontend.pid" ]; then
        PID=$(cat "$PID_DIR/frontend.pid")
        if kill -0 "$PID" 2>/dev/null; then
            kill "$PID" && success "Frontend stopped (PID $PID)"
        else
            warn "Frontend PID $PID not running"
        fi
        rm -f "$PID_DIR/frontend.pid"
    else
        PID=$(lsof -ti:5173 2>/dev/null || true)
        if [ -n "$PID" ]; then
            kill "$PID" 2>/dev/null && success "Frontend stopped (PID $PID)"
        else
            info "No frontend process found"
        fi
    fi

    success "All services stopped"
}

# ═════════════════════════════════════════════════════════════════
# INSTALL — system deps, Python, Node, Docker
# ═════════════════════════════════════════════════════════════════
do_install() {
    step "1/6 — System Dependencies"

    if command -v apt-get &>/dev/null; then
        info "Detected Debian/Ubuntu — updating package list..."
        sudo apt-get update -qq
        sudo apt-get install -y -qq \
            curl wget git build-essential software-properties-common \
            lsof ca-certificates gnupg 2>/dev/null
        success "System packages installed"
    else
        warn "Not a Debian/Ubuntu system — skipping apt. Ensure curl, git, build-essential are installed."
    fi

    # ── Python 3.12+ ─────────────────────────────────────────────
    step "2/6 — Python 3.12+"

    PYTHON_CMD=""
    for cmd in python3.12 python3.13 python3; do
        if command -v "$cmd" &>/dev/null; then
            PY_VER=$("$cmd" --version 2>&1 | grep -oP '\d+\.\d+' | head -1)
            PY_MAJOR=$(echo "$PY_VER" | cut -d. -f1)
            PY_MINOR=$(echo "$PY_VER" | cut -d. -f2)
            if [ "$PY_MAJOR" -ge 3 ] && [ "$PY_MINOR" -ge 12 ]; then
                PYTHON_CMD="$cmd"
                break
            fi
        fi
    done

    if [ -z "$PYTHON_CMD" ]; then
        info "Python 3.12+ not found — installing..."
        if command -v apt-get &>/dev/null; then
            sudo add-apt-repository -y ppa:deadsnakes/ppa 2>/dev/null || true
            sudo apt-get update -qq
            sudo apt-get install -y -qq python3.12 python3.12-venv python3.12-dev
            PYTHON_CMD="python3.12"
        else
            error "Cannot auto-install Python 3.12. Please install manually."
        fi
    fi

    success "Python: $($PYTHON_CMD --version)"

    # ── Node.js 22 ───────────────────────────────────────────────
    step "3/6 — Node.js 22+"

    NODE_OK=false
    if command -v node &>/dev/null; then
        NODE_VER=$(node --version | grep -oP '\d+' | head -1)
        if [ "$NODE_VER" -ge 18 ]; then
            NODE_OK=true
        fi
    fi

    if [ "$NODE_OK" = false ]; then
        info "Node.js 18+ not found — installing Node 22 via NodeSource..."
        if command -v apt-get &>/dev/null; then
            curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
            sudo apt-get install -y -qq nodejs
        else
            error "Cannot auto-install Node.js. Please install Node 18+ manually."
        fi
    fi

    success "Node: $(node --version), npm: $(npm --version)"

    # ── Docker ───────────────────────────────────────────────────
    step "4/6 — Docker & Docker Compose"

    if ! command -v docker &>/dev/null; then
        info "Docker not found — installing via official script..."
        curl -fsSL https://get.docker.com | sudo sh
        sudo usermod -aG docker "$USER" 2>/dev/null || true
        success "Docker installed. You may need to log out/in for group changes."
    fi

    # Start Docker daemon if not running
    if ! docker info &>/dev/null 2>&1; then
        info "Starting Docker daemon..."
        sudo systemctl start docker 2>/dev/null || sudo service docker start 2>/dev/null || true
        sleep 2
    fi

    if docker info &>/dev/null 2>&1; then
        success "Docker: $(docker --version | head -1)"
    else
        warn "Docker is installed but not running. You may need: sudo systemctl start docker"
    fi

    # Verify docker compose v2
    if docker compose version &>/dev/null 2>&1; then
        success "Docker Compose: $(docker compose version --short 2>/dev/null || echo 'v2')"
    else
        warn "Docker Compose v2 not available. Install: sudo apt-get install docker-compose-v2"
    fi

    # ── Python venv & deps ───────────────────────────────────────
    step "5/6 — Python Virtual Environment & Dependencies"

    if [ ! -d "$VENV_DIR" ]; then
        info "Creating virtual environment..."
        "$PYTHON_CMD" -m venv "$VENV_DIR"
    fi

    source "$VENV_DIR/bin/activate"
    pip install --upgrade pip -q
    pip install -r "$API_DIR/requirements.txt" -q
    success "Python dependencies installed ($(pip list 2>/dev/null | wc -l) packages)"

    # ── Node packages ────────────────────────────────────────────
    step "6/6 — Frontend Dependencies"

    cd "$UI_DIR"
    if [ ! -d "node_modules" ]; then
        info "Installing npm packages..."
        npm ci --no-audit --no-fund 2>/dev/null || npm install --no-audit --no-fund
    else
        info "node_modules exists — running npm install to sync..."
        npm install --no-audit --no-fund 2>/dev/null
    fi
    success "Frontend dependencies installed"

    echo ""
    success "All dependencies installed!"
}

# ═════════════════════════════════════════════════════════════════
# CONFIGURE — generate .env files
# ═════════════════════════════════════════════════════════════════
do_configure() {
    step "Configuring Environment"

    VPS_IP=$(get_public_ip)
    IS_VPS=false
    if [ "$VPS_IP" != "localhost" ] && [ "$VPS_IP" != "127.0.0.1" ]; then
        IS_VPS=true
        info "Detected VPS with IP: $VPS_IP"
    else
        info "Running locally"
    fi

    # ── Backend .env ─────────────────────────────────────────────
    if [ ! -f "$API_DIR/.env" ]; then
        info "Creating backend .env..."
        cp "$API_DIR/.env.example" "$API_DIR/.env"

        # Prompt for OpenRouter API key
        echo ""
        echo -e "${BOLD}OpenRouter API Key${NC} (required for LLM access)"
        echo -e "Get one at: ${CYAN}https://openrouter.ai${NC}"
        read -rp "Enter your OPENROUTER_API_KEY (or press Enter to skip): " OR_KEY
        if [ -n "$OR_KEY" ]; then
            sed -i "s|^OPENROUTER_API_KEY=.*|OPENROUTER_API_KEY=$OR_KEY|" "$API_DIR/.env"
        fi

        # Generate a random SECRET_KEY
        SECRET=$(openssl rand -hex 32 2>/dev/null || python3 -c "import secrets; print(secrets.token_hex(32))")
        sed -i "s|^SECRET_KEY=.*|SECRET_KEY=$SECRET|" "$API_DIR/.env"

        # Set CORS for VPS
        if [ "$IS_VPS" = true ]; then
            sed -i "s|^CORS_ORIGINS=.*|CORS_ORIGINS=http://$VPS_IP:5173,http://$VPS_IP:3000|" "$API_DIR/.env"
        fi

        success "Backend .env created"
    else
        info "Backend .env already exists — skipping"
    fi

    # ── Frontend .env ────────────────────────────────────────────
    if [ ! -f "$UI_DIR/.env" ]; then
        info "Creating frontend .env..."
        cp "$UI_DIR/.env.example" "$UI_DIR/.env"

        # Set API URL for VPS
        if [ "$IS_VPS" = true ]; then
            sed -i "s|^VITE_API_URL=.*|VITE_API_URL=http://$VPS_IP:8000/api|" "$UI_DIR/.env"
        fi

        success "Frontend .env created"
    else
        info "Frontend .env already exists — skipping"
    fi
}

# ═════════════════════════════════════════════════════════════════
# START — launch backend + frontend
# ═════════════════════════════════════════════════════════════════
do_start() {
    step "Starting Aether Orchestrator"

    VPS_IP=$(get_public_ip)

    # ── Backend ──────────────────────────────────────────────────
    info "Starting backend API server..."

    # Check if port 8000 is already in use
    if lsof -ti:8000 &>/dev/null; then
        warn "Port 8000 is already in use. Stopping existing process..."
        kill "$(lsof -ti:8000)" 2>/dev/null || true
        sleep 1
    fi

    source "$VENV_DIR/bin/activate"
    cd "$API_DIR"
    nohup "$PYTHON_CMD" -m uvicorn main:app --host 0.0.0.0 --port 8000 \
        > "$SCRIPT_DIR/.pids/backend.log" 2>&1 &
    BACKEND_PID=$!
    echo "$BACKEND_PID" > "$PID_DIR/backend.pid"

    # Wait for backend to be ready
    info "Waiting for backend to start..."
    for i in $(seq 1 20); do
        if curl -s http://localhost:8000/api/health &>/dev/null; then
            success "Backend running on port 8000 (PID $BACKEND_PID)"
            break
        fi
        if [ "$i" -eq 20 ]; then
            warn "Backend may still be starting. Check: tail -f .pids/backend.log"
        fi
        sleep 1
    done

    # ── Frontend ─────────────────────────────────────────────────
    info "Starting frontend dev server..."

    if lsof -ti:5173 &>/dev/null; then
        warn "Port 5173 is already in use. Stopping existing process..."
        kill "$(lsof -ti:5173)" 2>/dev/null || true
        sleep 1
    fi

    cd "$UI_DIR"
    nohup npx vite --host 0.0.0.0 --port 5173 \
        > "$SCRIPT_DIR/.pids/frontend.log" 2>&1 &
    FRONTEND_PID=$!
    echo "$FRONTEND_PID" > "$PID_DIR/frontend.pid"

    # Wait for frontend
    for i in $(seq 1 15); do
        if curl -s http://localhost:5173 &>/dev/null; then
            success "Frontend running on port 5173 (PID $FRONTEND_PID)"
            break
        fi
        if [ "$i" -eq 15 ]; then
            warn "Frontend may still be starting. Check: tail -f .pids/frontend.log"
        fi
        sleep 1
    done

    # ── Summary ──────────────────────────────────────────────────
    echo ""
    echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}${BOLD}  Aether Orchestrator is running!${NC}"
    echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
    echo ""
    if [ "$VPS_IP" != "localhost" ] && [ "$VPS_IP" != "127.0.0.1" ]; then
        echo -e "  ${BOLD}Frontend:${NC}  http://$VPS_IP:5173"
        echo -e "  ${BOLD}Backend:${NC}   http://$VPS_IP:8000"
        echo -e "  ${BOLD}API Docs:${NC}  http://$VPS_IP:8000/docs"
        echo -e "  ${BOLD}Docs Page:${NC} http://$VPS_IP:5173/docs.html"
    else
        echo -e "  ${BOLD}Frontend:${NC}  http://localhost:5173"
        echo -e "  ${BOLD}Backend:${NC}   http://localhost:8000"
        echo -e "  ${BOLD}API Docs:${NC}  http://localhost:8000/docs"
        echo -e "  ${BOLD}Docs Page:${NC} http://localhost:5173/docs.html"
    fi
    echo ""
    echo -e "  ${BOLD}Default Login:${NC} admin / Oc123"
    echo ""
    echo -e "  ${CYAN}Logs:${NC}"
    echo -e "    Backend:  tail -f $SCRIPT_DIR/.pids/backend.log"
    echo -e "    Frontend: tail -f $SCRIPT_DIR/.pids/frontend.log"
    echo ""
    echo -e "  ${CYAN}Stop:${NC}  ./setup.sh --stop"
    echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
}

# ═════════════════════════════════════════════════════════════════
# MAIN
# ═════════════════════════════════════════════════════════════════

echo -e "${BOLD}"
echo "  ╔═══════════════════════════════════════════╗"
echo "  ║       AETHER ORCHESTRATOR SETUP           ║"
echo "  ║   One-Click AI Agent Infrastructure       ║"
echo "  ╚═══════════════════════════════════════════╝"
echo -e "${NC}"

# Find usable Python command (needed for --start too)
PYTHON_CMD=""
for cmd in python3.12 python3.13 python3; do
    if command -v "$cmd" &>/dev/null; then
        PY_VER=$("$cmd" --version 2>&1 | grep -oP '\d+\.\d+' | head -1)
        PY_MAJOR=$(echo "$PY_VER" | cut -d. -f1)
        PY_MINOR=$(echo "$PY_VER" | cut -d. -f2)
        if [ "$PY_MAJOR" -ge 3 ] && [ "$PY_MINOR" -ge 12 ]; then
            PYTHON_CMD="$cmd"
            break
        fi
    fi
done

case "${1:-}" in
    --stop)
        do_stop
        ;;
    --start)
        [ -z "$PYTHON_CMD" ] && error "Python 3.12+ not found. Run: ./setup.sh --install first"
        do_start
        ;;
    --install)
        do_install
        do_configure
        success "Installation complete. Run: ./setup.sh --start"
        ;;
    *)
        # Full setup: install + configure + start
        do_install
        do_configure
        do_start
        ;;
esac
