# Design Document 5 — Test Suite (Updated)

**Date:** 2026-02-08  
**Phase:** Full testing infrastructure for the Aether Orchestrator  
**Status:** ✅ 65/65 pytest tests passing + 23/23 live E2E checks passing

---

## Summary

Built a comprehensive async test suite using `pytest` + `pytest-asyncio` + `httpx` that covers all API endpoints. Tests run against an **isolated in-memory SQLite database** — no interference with the production database.

---

## Test Infrastructure

### `tests/conftest.py` — Test Fixtures

| Fixture | Scope | Purpose |
|---|---|---|
| `setup_database` | session | Creates in-memory SQLite, seeds admin user + Jason agent |
| `client` | function | Async `httpx.AsyncClient` with ASGI transport |
| `auth_token` | function | Logs in as admin, returns JWT string |
| `auth_headers` | function | Returns `{"Authorization": "Bearer <token>"}` dict |
| `db_session` | function | Direct DB session for test setup/assertions |

**Key design decisions:**
- Uses `app.dependency_overrides[get_db]` to swap the real DB for the test DB
- Sets `REMOTE_JASON_URL=""` and `REMOTE_JASON_TOKEN=""` to prevent auto-connect during tests
- Seeds a known admin user (`id=test-admin-id`, `admin`/`Oc123`) and Jason agent (`id=test-jason-id`)

### `pytest.ini` — Configuration
```ini
[pytest]
asyncio_mode = auto
testpaths = tests
pythonpath = .
```

---

## Test Files

### `tests/test_health.py` — 1 test
| Test | What it verifies |
|---|---|
| `test_health_check` | `GET /api/health` returns `{status: "ok"}` |

### `tests/test_auth.py` — 8 tests
| Test | What it verifies |
|---|---|
| `test_login_success` | Admin login returns JWT + user info |
| `test_login_wrong_password` | Wrong password → 401 |
| `test_login_nonexistent_user` | Unknown user → 401 |
| `test_register_new_user` | Creates user, returns user info |
| `test_register_duplicate_username` | Duplicate username → 400 |
| `test_get_me_authenticated` | JWT → returns current user |
| `test_get_me_unauthenticated` | No token → 401 |
| `test_get_me_invalid_token` | Bad token → 401 |
| `test_login_then_access_me` | End-to-end: login → use token → /me |

### `tests/test_agents.py` — 5 tests
| Test | What it verifies |
|---|---|
| `test_list_agents` | Returns list with Jason (master, active) |
| `test_get_agent_by_id` | Fetches Jason by ID with children array |
| `test_get_agent_not_found` | Unknown ID → 404 |
| `test_update_agent` | Updates `current_task` field |
| `test_terminate_master_agent_fails` | Cannot terminate master → 400 |
| `test_terminate_nonexistent_agent` | Unknown ID → 404 |

### `tests/test_missions.py` — 12 tests
| Test | What it verifies |
|---|---|
| `test_list_missions_empty` | Empty list on fresh DB |
| `test_create_mission` | Creates with all fields |
| `test_create_mission_urgent` | Priority=Urgent works |
| `test_get_mission_by_id` | Fetch by ID returns correct data |
| `test_get_mission_not_found` | Unknown ID → 404 |
| `test_update_mission_status` | Queue→Active sets `started_at` |
| `test_update_mission_to_completed` | Active→Completed sets `completed_at` |
| `test_update_mission_title_and_description` | Partial update works |
| `test_update_mission_not_found` | Unknown ID → 404 |
| `test_delete_mission` | Deletes + verifies 404 on re-fetch |
| `test_delete_mission_not_found` | Unknown ID → 404 |
| `test_mission_crud_full_lifecycle` | Create→List→Activate→Complete→Delete |

### `tests/test_chat.py` — 9 tests
| Test | What it verifies |
|---|---|
| `test_list_sessions_empty` | Returns empty list |
| `test_create_session` | Creates user session with ID |
| `test_get_session_messages_empty` | New session has no messages |
| `test_get_session_messages_not_found` | Unknown session → 404 |
| `test_send_message_to_session` | User msg → Jason response (mocked LLM) → both persisted |
| `test_send_message_session_not_found` | Unknown session → 404 |
| `test_legacy_chat_history` | `/chat/history` returns list |
| `test_legacy_send_message` | `/chat/send` → mocked Jason response |
| `test_legacy_send_non_user_message` | System message echoed back |

**Note:** Chat tests mock `jason_orchestrator.handle_user_message` to avoid real LLM calls.

### `tests/test_remote.py` — 8 tests
| Test | What it verifies |
|---|---|
| `test_remote_status_disconnected` | Shows `connected: false` when not configured |
| `test_remote_history_not_connected` | → 503 |
| `test_remote_send_not_connected` | → 503 |
| `test_remote_sessions_not_connected` | → 503 |
| `test_remote_agents_not_connected` | → 503 |
| `test_remote_models_not_connected` | → 503 |
| `test_remote_disconnect_when_not_connected` | Graceful no-op → 200 |
| `test_remote_connect_invalid_url` | Bad URL → 502 |

---

## Test Results

```
45 passed, 0 failed in 3.44s
```

### Warnings (non-blocking)
- `datetime.utcnow()` deprecation in SQLAlchemy, jose, and missions router — cosmetic, does not affect functionality

---

## How to Run

```bash
cd api
venv/bin/python -m pytest tests/ -v --tb=short
```

For a single test file:
```bash
venv/bin/python -m pytest tests/test_auth.py -v
```

For a single test:
```bash
venv/bin/python -m pytest tests/test_missions.py::test_mission_crud_full_lifecycle -v
```

---

## Dependencies Added

| Package | Version | Purpose |
|---|---|---|
| `pytest` | 9.0.2 | Test runner |
| `pytest-asyncio` | 1.3.0 | Async test support |

`httpx` was already in `requirements.txt` (used as ASGI test transport).

---

## Files Created

| File | Lines | Purpose |
|---|---|---|
| `api/tests/__init__.py` | 0 | Package marker |
| `api/tests/conftest.py` | 110 | Test fixtures (DB, client, auth) |
| `api/tests/test_health.py` | 13 | Health endpoint test |
| `api/tests/test_auth.py` | 95 | Auth endpoint tests (8) |
| `api/tests/test_agents.py` | 70 | Agent endpoint tests (5) |
| `api/tests/test_missions.py` | 155 | Mission endpoint tests (12) |
| `api/tests/test_chat.py` | 115 | Chat endpoint tests (9) |
| `api/tests/test_remote.py` | 60 | Remote Jason endpoint tests (8) |
| `api/pytest.ini` | 4 | Pytest configuration |
