# Bug Fix: WSS Connection Blocked by Cloudflare Access

**Date:** 2026-02-10  
**Status:** Fixed (awaiting user's CF Access credentials to fully connect)

---

## Issue

User attempted to connect to a new WSS endpoint from the UI:
- **URL:** `wss://moltbot-hetzner.kiran-ocaisolutions.workers.dev`
- **Token:** `8987d3be5cb9ffe2d3e0ad5634b1a1bae849e89854b87653aa2580be3f9d21b9`

Connection failed with an error.

## Root Cause

The WSS endpoint is behind **Cloudflare Access (Zero Trust)**. Every request — including WebSocket upgrade — gets intercepted by Cloudflare and redirected (HTTP 302) to the CF Access login page:

```
302 → https://kiran-ocaisolutions.cloudflareaccess.com/cdn-cgi/access/login/...
```

The JWT payload in the redirect confirms:
```json
{
  "service_token_status": false,
  "auth_status": "NONE"
}
```

**No valid authentication was detected.** The token the user provided (`8987d3be...`) is the **OpenClaw gateway auth token**, not a Cloudflare Access service token. CF Access requires a **separate** pair of credentials:
- `CF-Access-Client-Id` — Service token Client ID
- `CF-Access-Client-Secret` — Service token Client Secret

These are created in the Cloudflare Zero Trust dashboard under **Access → Service Auth → Service Tokens**.

## Debugging Steps

| Step | Method | Result |
|------|--------|--------|
| 1 | `websockets.connect(url?token=...)` | 302 redirect to CF login |
| 2 | `Authorization: Bearer <token>` header | 302 redirect |
| 3 | `Cookie: CF_Authorization=<token>` | 302 redirect |
| 4 | `CF-Access-Client-Id` + `CF-Access-Client-Secret` headers (with test values) | 302 redirect (invalid creds) |
| 5 | Plain HTTPS GET | 302 redirect |

All attempts returned the same CF Access redirect. The `service_token_status: false` in the JWT confirms no valid service token was presented.

## Fix Applied

### 1. Backend: `api/services/remote_jason.py`

**`RemoteJasonClient.__init__`** — Added `cf_client_id` and `cf_client_secret` parameters:
```python
def __init__(
    self, url, token, session_key="agent:main:main",
    on_event=None,
    cf_client_id=None,    # NEW
    cf_client_secret=None, # NEW
):
```

**`RemoteJasonClient.connect()`** — Passes CF Access headers to `websockets.connect()`:
```python
extra_headers = {}
if self.cf_client_id and self.cf_client_secret:
    extra_headers["CF-Access-Client-Id"] = self.cf_client_id
    extra_headers["CF-Access-Client-Secret"] = self.cf_client_secret

ws = await asyncio.wait_for(
    websockets.connect(self.url, extra_headers=extra_headers or None, ...),
    timeout=15,
)
```

**Error detection** — Catches CF Access redirects and provides a clear error message:
```python
except Exception as e:
    if "cloudflareaccess.com" in str(e) or "access/login" in str(e):
        raise RuntimeError(
            "Cloudflare Access is blocking the connection. "
            "Please provide CF-Access-Client-Id and CF-Access-Client-Secret."
        )
```

**Timeout** — Added 15s `asyncio.wait_for` timeout to prevent hanging when CF Access blocks.

**`RemoteJasonManager.connect()`** — Passes through `cf_client_id` and `cf_client_secret`.

### 2. Backend: `api/routers/remote.py`

**`RemoteConnectRequest`** — Added optional CF Access fields:
```python
class RemoteConnectRequest(BaseModel):
    url: str
    token: str
    session_key: str = "agent:main:main"
    cf_client_id: Optional[str] = None      # NEW
    cf_client_secret: Optional[str] = None   # NEW
```

**`/remote/connect` endpoint** — Passes CF Access fields to manager.

### 3. Frontend: `ui/src/api.ts`

**`RemoteConnectRequest`** — Added CF Access fields:
```typescript
export interface RemoteConnectRequest {
    url: string;
    token: string;
    session_key?: string;
    cf_client_id?: string;      // NEW
    cf_client_secret?: string;   // NEW
}
```

### 4. Frontend: `ui/src/components/RemoteConfig.tsx`

**State variables** — Added `cfClientId`, `cfClientSecret`, `showCfSecret`.

**Connection form** — CF Access fields auto-appear when a `wss://` URL is entered:
```tsx
{url.startsWith('wss://') && (
    <div className="mt-4 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
        <Shield /> Cloudflare Access (Zero Trust)
        <Field label="CF Access Client ID">...</Field>
        <Field label="CF Access Client Secret">...</Field>
    </div>
)}
```

**`handleConnect`** — Passes CF Access fields to `connectRemote()`.

## Files Modified

| File | Change |
|------|--------|
| `api/services/remote_jason.py` | Added `cf_client_id`/`cf_client_secret` to `__init__`, `connect()`, `RemoteJasonManager.connect()`; CF Access redirect detection; 15s timeout |
| `api/routers/remote.py` | Added `cf_client_id`/`cf_client_secret` to `RemoteConnectRequest` and `/connect` endpoint |
| `ui/src/api.ts` | Added `cf_client_id`/`cf_client_secret` to `RemoteConnectRequest` interface |
| `ui/src/components/RemoteConfig.tsx` | Added CF Access input fields (auto-shown for `wss://` URLs), state variables, pass-through to `connectRemote()` |

## Verified Behavior

| Scenario | Result |
|----------|--------|
| WSS URL without CF Access creds | Clear error: "Cloudflare Access is blocking..." |
| WSS URL with invalid CF Access creds | Clear error: "Cloudflare Access is blocking..." |
| WSS URL with valid CF Access creds | Pending — user needs to provide valid creds |
| WS URL (non-Cloudflare) | Works as before — CF Access fields hidden |

## What the User Needs To Do

1. Go to **Cloudflare Zero Trust dashboard** → Access → Service Auth → Service Tokens
2. Create a new service token for the `moltbot-hetzner` application
3. Copy the **Client ID** and **Client Secret**
4. In the Aether UI, enter:
   - **WebSocket URL:** `wss://moltbot-hetzner.kiran-ocaisolutions.workers.dev`
   - **Auth Token:** `8987d3be5cb9ffe2d3e0ad5634b1a1bae849e89854b87653aa2580be3f9d21b9` (OpenClaw gateway token)
   - **CF Access Client ID:** (from step 3)
   - **CF Access Client Secret:** (from step 3)
5. Click **Connect**

Alternatively, the user can **disable Cloudflare Access** on the `moltbot-hetzner` application in the CF Zero Trust dashboard if authentication is not needed.
