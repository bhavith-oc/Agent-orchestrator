# Design Document 3 — Login Failure: CORS Preflight Bug

**Date:** 2026-02-08  
**Phase:** Bug fix — login failing from browser  
**Status:** ✅ Resolved

---

## Issue

After wiring the UI to the new backend, login with `admin` / `Oc123` started failing from the browser. The login button would show the loading spinner briefly, then display "Invalid credentials. Access denied." — even though the credentials were correct.

---

## Diagnosis

### Step 1: Check backend logs

The running uvicorn server showed:

```
INFO:     127.0.0.1:43954 - "POST /api/auth/login HTTP/1.1" 200 OK
INFO:     127.0.0.1:58436 - "OPTIONS /api/auth/login HTTP/1.1" 400 Bad Request
INFO:     127.0.0.1:58436 - "OPTIONS /api/auth/login HTTP/1.1" 400 Bad Request
INFO:     127.0.0.1:52076 - "OPTIONS /api/auth/login HTTP/1.1" 400 Bad Request
```

**Key observation:** The `POST` request itself returned `200 OK` when tested directly (e.g., via `curl`). But the browser was sending `OPTIONS` preflight requests that returned `400 Bad Request`.

### Step 2: Understand the CORS preflight mechanism

When a browser makes a cross-origin `POST` request with `Content-Type: application/json`, it first sends an `OPTIONS` preflight request to check if the server allows the cross-origin call. The server must respond with:
- `Access-Control-Allow-Origin: <origin>`
- `Access-Control-Allow-Methods: POST`
- `Access-Control-Allow-Headers: content-type`

If the preflight fails (400), the browser **never sends the actual POST** — it rejects the request client-side.

### Step 3: Identify the origin mismatch

The CORS config in `api/main.py` allowed:
```python
origins = [
    "http://localhost:5173",   # Vite default
    "http://localhost:3000",   # CRA default
    "http://localhost:8080",   # generic
]
```

But the Vite dev server was actually running on **port 5174** — Vite auto-increments the port when `5173` is already in use (e.g., by another dev server or a previous instance that didn't fully shut down).

### Step 4: Verify with curl

```bash
# Port 5173 — WORKS (allowed origin)
curl -X OPTIONS http://localhost:8000/api/auth/login \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: POST"
# → 200 OK, access-control-allow-origin: http://localhost:5173

# Port 5174 — FAILS (disallowed origin)
curl -X OPTIONS http://localhost:8000/api/auth/login \
  -H "Origin: http://localhost:5174" \
  -H "Access-Control-Request-Method: POST"
# → 400 Bad Request, "Disallowed CORS origin"
```

This confirmed the root cause: **the UI was on port 5174, which was not in the CORS allow list**.

---

## Root Cause

**Vite port auto-increment + incomplete CORS origin list.**

Vite's dev server defaults to port `5173`, but if that port is occupied, it silently increments to `5174`, `5175`, etc. The backend's CORS middleware only allowed `5173`, so any request from `5174+` was rejected at the preflight stage.

The login appeared to fail with "Invalid credentials" because the `Login.tsx` error handler catches all errors:
```tsx
} catch (err: any) {
    const msg = err?.response?.data?.detail || 'Invalid credentials. Access denied.'
    setError(msg)
}
```

Since the CORS preflight failure produces a **network error** (no response body), `err.response` is `undefined`, so it falls through to the default message — making it look like a credentials problem when it was actually a CORS problem.

---

## Fix

### File modified: `api/main.py`

**One-line change** — added ports `5174` and `5175` to the CORS origins list:

```python
# BEFORE
origins = [
    "http://localhost:5173",
    "http://localhost:3000",
    "http://localhost:8080",
]

# AFTER
origins = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://localhost:3000",
    "http://localhost:8080",
]
```

After restarting the backend, the preflight from `5174` returns `200 OK` and login works.

---

## Verification

| Test | Result |
|---|---|
| `OPTIONS /api/auth/login` from `localhost:5174` | ✅ `200 OK` with correct CORS headers |
| `POST /api/auth/login` with admin/Oc123 | ✅ Returns JWT token |
| Browser login from Vite dev server | ✅ Authenticates successfully |

---

## Lessons Learned

1. **Always include Vite fallback ports in CORS** — `5173`, `5174`, `5175` at minimum
2. **CORS preflight failures are silent in the browser** — they produce network errors with no response body, making them easy to misdiagnose as backend errors
3. **Error handlers should distinguish network errors from API errors** — a future improvement would be to check for `err.code === 'ERR_NETWORK'` and show "Cannot reach server (possible CORS issue)" instead of "Invalid credentials"

---

## Severity & Importance

- **Severity:** 🔴 High — completely blocks login from the browser
- **Root cause complexity:** Low — single config line
- **Time to diagnose:** ~2 minutes (backend logs immediately showed `OPTIONS 400`)
- **Files changed:** 1 (`api/main.py`, line 57-63)
