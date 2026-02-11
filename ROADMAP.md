# Aether Orchestrator — Roadmap

## Current State (February 2026)

### What's Working

| Feature | Status | Notes |
|---------|--------|-------|
| **Backend API** | Stable | FastAPI server with all core endpoints operational |
| **Authentication** | Stable | JWT + Google OAuth + legacy login |
| **One-Click Deploy** | Stable | Docker-based OpenClaw agent deployment with lifecycle logs |
| **Deployment Logs** | Stable | STEP/INFO lifecycle messages + filtered container logs |
| **Gateway Health Check** | Stable | HTTP + WebSocket probe with full OpenClaw protocol |
| **Remote OpenClaw** | Stable | Persistent WS connection with auto-reconnect, event routing |
| **Agent Hub (Chat)** | Stable | Real-time chat with remote + locally deployed agents |
| **Mission Board** | Stable | CRUD missions with status tracking |
| **Agent Pool** | Stable | Agent registry with capabilities |
| **Onboarding Flow** | Stable | 5-phase guided setup (Auth → Install → Config → Deploy → Ready) |
| **Deploy Agent Page** | Stable | Manual deployment management with logs viewer |
| **Settings (RemoteConfig)** | Stable | Remote OpenClaw connection management UI |
| **System Metrics** | Scaffold | Basic psutil endpoint, UI placeholder |
| **CLI Deploy** | Stable | Interactive `deploy.sh` script |
| **Electron App** | Scaffold | Basic structure (main.js, preload.js, docker-manager.js) |
| **Browser Debug Flags** | Stable | `__AETHER_SKIP_AUTH__`, `__AETHER_NAV__`, etc. |

### Known Issues / Technical Debt

| Issue | Priority | Description |
|-------|----------|-------------|
| Lifecycle logs are in-memory only | Medium | Deployment logs are lost on backend restart. Consider persisting to disk. |
| Single admin user seeded | Low | Default `admin/Oc123` — needs proper user management |
| CORS origins hardcoded | Low | Should be configurable via env var |
| Chunk size warning on build | Low | UI bundle >500KB — needs code splitting |
| No rate limiting | Medium | API endpoints have no rate limiting |
| No HTTPS | Medium | Backend serves HTTP only — needs reverse proxy for production |

---

## Roadmap

### Phase 1: Hardening (Current)

Focus: Stability, error handling, and developer experience.

- [x] Fix gateway health check WebSocket handshake (wrong protocol + client.id)
- [x] Fix false-positive error detection in deployment progress
- [x] Make `gateway_client_id` configurable for local vs remote containers
- [x] Add deployment lifecycle log buffer with STEP/INFO messages
- [x] Strip ANSI codes and filter noisy warnings from container logs
- [x] Add browser debug flags for development
- [x] Create project documentation (ARCHITECTURE, README, SETUP, ROADMAP)
- [ ] Persist deployment logs to disk (survive backend restarts)
- [ ] Add deployment cleanup (auto-remove stale containers on startup)
- [ ] Improve error messages in onboarding flow

### Phase 2: Multi-Agent Orchestration

Focus: Jason master agent capabilities and sub-agent coordination.

- [ ] Task decomposition via LLM (Jason breaks complex requests into subtasks)
- [ ] Sub-agent parallel execution in isolated git worktrees
- [ ] Progress tracking and real-time updates via WebSocket
- [ ] Mission dependency graph (subtask ordering)
- [ ] Agent capability matching (assign tasks to best-suited agents)
- [ ] Discussion/progress writer for mission threads

### Phase 3: Production Readiness

Focus: Security, scalability, and deployment.

- [ ] HTTPS support (TLS termination or reverse proxy config)
- [ ] Rate limiting on API endpoints
- [ ] Configurable CORS origins via environment variable
- [ ] User management (roles, permissions, multi-user)
- [ ] API key rotation and secure storage
- [ ] Database migration system (Alembic)
- [ ] Health check endpoint improvements (dependency checks)
- [ ] Structured logging (JSON format for log aggregation)
- [ ] Docker image for Aether itself (multi-stage build is ready)

### Phase 4: Advanced Features

Focus: Enhanced capabilities and integrations.

- [ ] **Multi-container deployments** — Deploy multiple agents with different configs
- [ ] **Agent templates** — Pre-configured agent profiles (coding, research, support)
- [ ] **Deployment presets** — Save and reuse deployment configurations
- [ ] **Webhook notifications** — Notify external services on deployment/mission events
- [ ] **System Metrics dashboard** — Real-time CPU/memory/disk visualization
- [ ] **Audit log** — Track all user actions and agent activities
- [ ] **Export/Import** — Backup and restore deployments, missions, chat history

### Phase 5: Desktop & Distribution

Focus: Electron app and packaging.

- [ ] **Electron app** — Desktop wrapper with native Docker management
- [ ] **Auto-update** — Electron auto-updater
- [ ] **System tray** — Background agent monitoring
- [ ] **Native notifications** — Desktop alerts for agent events
- [ ] **Installer packages** — .deb, .dmg, .exe distributions

---

## Architecture Evolution

### Current Architecture
```
Browser → FastAPI Backend → SQLite
                         → Docker (local OpenClaw containers)
                         → Remote OpenClaw (WebSocket)
                         → OpenRouter (LLM API)
```

### Target Architecture
```
Browser / Electron → FastAPI Backend → PostgreSQL
                                    → Docker Swarm / K8s (multi-agent)
                                    → Remote OpenClaw cluster
                                    → Multiple LLM providers
                                    → Redis (caching, pub/sub)
                                    → S3 (artifact storage)
```

---

## Version History

| Version | Date | Highlights |
|---------|------|------------|
| 0.1.0 | Jan 2026 | Initial prototype — Jason orchestrator, basic chat, mission board |
| 0.2.0 | Jan 2026 | Remote OpenClaw connection, Cloudflare Access support |
| 0.3.0 | Feb 2026 | One-click Docker deployment, onboarding flow |
| 0.4.0 | Feb 2026 | Gateway health check, deployment logs, deploy-chat |
| 0.5.0 | Feb 2026 | Lifecycle log buffer, browser debug flags, documentation |

---

## Contributing

1. Check the [ARCHITECTURE.md](./ARCHITECTURE.md) for system design
2. Check the [context/](./context/) folder for design docs and bug fix history
3. Follow existing code patterns (async services, Pydantic schemas, typed React components)
4. Add tests for new backend features in `api/tests/`
5. Document significant changes in `context/` with appropriate prefix (`feature_`, `bug_fix_`, `design_`)
