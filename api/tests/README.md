# Aether Orchestrator — Test Suite

**Source of truth** for verifying all core functionality of the Aether Orchestrator API.

---

## How to Run

```bash
cd api

# Run all tests
venv/bin/python -m pytest tests/ -v --tb=short

# Run a specific test file
venv/bin/python -m pytest tests/test_auth.py -v

# Run a specific test
venv/bin/python -m pytest tests/test_missions.py::test_mission_crud_full_lifecycle -v

# Run with coverage (if pytest-cov installed)
venv/bin/python -m pytest tests/ -v --cov=. --cov-report=term-missing
```

---

## Test Architecture

- **Database:** Isolated in-memory SQLite — no production DB interference
- **Client:** Async `httpx.AsyncClient` with ASGI transport (no real HTTP server needed)
- **LLM calls:** Mocked via `unittest.mock.patch` — no real OpenRouter calls
- **Remote Jason:** Disabled during tests (`REMOTE_JASON_URL=""`) — tests verify 503 guards
- **Seeded data:** Admin user (`admin`/`Oc123`) + Jason master agent

---

## Test Files

### `conftest.py` — Shared Fixtures
| Fixture | Purpose |
|---|---|
| `setup_database` | Creates in-memory SQLite, seeds admin + Jason |
| `client` | Async HTTP test client |
| `auth_token` | JWT token for admin user |
| `auth_headers` | `{"Authorization": "Bearer <token>"}` dict |
| `db_session` | Direct DB session for assertions |

### `test_health.py` — Health Check (1 test)
- `GET /api/health` returns `{status: "ok"}`

### `test_auth.py` — Authentication (8 tests)
- Login success / wrong password / nonexistent user
- Register new user / duplicate username rejection
- `/me` with valid token / no token / invalid token
- End-to-end: login → use token → access `/me`

### `test_agents.py` — Agent Management (5 tests)
- List agents (Jason present)
- Get agent by ID (with children)
- Agent not found (404)
- Update agent fields
- Cannot terminate master agent (400)

### `test_missions.py` — Mission CRUD (12 tests)
- List / Create / Get by ID / Not found
- Update status (Queue→Active sets `started_at`)
- Update to Completed (sets `completed_at`)
- Update title and description
- Delete + verify gone
- Full lifecycle: Create→List→Activate→Complete→Delete

### `test_chat.py` — Chat System (9 tests)
- Session CRUD (list, create, get messages)
- Send message with mocked Jason LLM response
- Legacy `/chat/history` and `/chat/send` endpoints
- Non-user message echo

### `test_metrics.py` — System Metrics (3 tests)
- Returns all expected fields
- Agent counts reflect seeded data
- Values within reasonable ranges

### `test_remote.py` — Remote Jason / OpenClaw (8 tests)
- Status shows disconnected when not configured
- All endpoints return 503 when not connected
- Graceful disconnect when already disconnected
- Invalid URL returns 502

### `test_services.py` — Core Service Unit Tests (12 tests)
- **Auth helpers:** hash_password, verify_password, create_access_token
- **LLM client:** Correct payload sent, JSON parsing, code fence stripping
- **Remote Jason:** Manager state, client state, flush_pending
- **Metrics service:** Direct service call returns valid data
- **Task planner:** Valid plan parsing, invalid structure rejection

---

## Total: 58 tests

All tests are designed to be **fast** (< 5 seconds total), **isolated** (no external dependencies), and **deterministic** (no flaky network calls).
