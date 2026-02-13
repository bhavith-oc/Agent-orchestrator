# Debug: WSS Cloudflare Access Connection Issue

**Date:** 2026-02-10  
**Status:** Partially Fixed — code changes complete, CF Access policy needs dashboard fix  
**Endpoint:** `wss://moltbot-hetzner.kiran-ocaisolutions.workers.dev`

---

## 1. Problem Statement

User attempted to connect to a new WSS endpoint from the Aether Orchestrator UI:
- **URL:** `wss://moltbot-hetzner.kiran-ocaisolutions.workers.dev`
- **Auth Token:** `8987d3be5cb9ffe2d3e0ad5634b1a1bae849e89854b87653aa2580be3f9d21b9`

The connection failed with an error. The UI showed a cryptic redirect URL from Cloudflare Access.

---

## 2. Initial Investigation

### 2.1 Backend API test (no CF Access creds)

```bash
curl -s -X POST http://localhost:8000/api/remote/connect \
  -H 'Content-Type: application/json' \
  -d '{"url":"wss://moltbot-hetzner.kiran-ocaisolutions.workers.dev","token":"8987d3be5cb9ffe2d3e0ad5634b1a1bae849e89854b87653aa2580be3f9d21b9"}'
```

**Output:**
```json
{"detail":"https://kiran-ocaisolutions.cloudflareaccess.com/cdn-cgi/access/login/moltbot-hetzner.kiran-ocaisolutions.workers.dev?kid=ef835860b6b33dda98a19d2e885e05128c89a9cff22b23d4eae30ee08c915e25&redirect_url=%2F&meta=eyJraWQ..."}
```

**Finding:** The endpoint returned a 302 redirect to the Cloudflare Access login page instead of completing the WebSocket handshake.

### 2.2 Direct WebSocket connection tests (Python websockets 13.1)

```python
# Test 1: token as query param
ws = await websockets.connect(f"{url}?token={token}")
# Result: InvalidURI — redirected to cloudflareaccess.com login

# Test 2: Authorization Bearer header
ws = await websockets.connect(url, extra_headers={"Authorization": f"Bearer {token}"})
# Result: InvalidURI — same CF Access redirect

# Test 3: CF_Authorization cookie
ws = await websockets.connect(url, extra_headers={"Cookie": f"CF_Authorization={token}"})
# Result: InvalidURI — same CF Access redirect

# Test 4: CF-Access headers (placeholder values)
ws = await websockets.connect(url, extra_headers={
    "CF-Access-Client-Id": "placeholder",
    "CF-Access-Client-Secret": token,
})
# Result: InvalidURI — same CF Access redirect
```

**Finding:** All 4 approaches returned the same Cloudflare Access redirect. The `websockets` library follows the HTTP 302 redirect and then fails because the target is HTTPS, not WSS.

### 2.3 JWT meta payload analysis

Decoded the JWT `meta` parameter from the redirect URL:

```json
{
    "type": "meta",
    "aud": "ef835860b6b33dda98a19d2e885e05128c89a9cff22b23d4eae30ee08c915e25",
    "hostname": "moltbot-hetzner.kiran-ocaisolutions.workers.dev",
    "service_token_status": false,
    "is_warp": false,
    "is_gateway": false,
    "auth_status": "NONE",
    "real_country": "IN"
}
```

**Key fields:**
- `service_token_status: false` — No valid service token was detected
- `auth_status: "NONE"` — No authentication of any kind was recognized
- `aud: ef835860b6...` — The CF Access Application ID

### 2.4 DNS investigation

```bash
dig +short moltbot-hetzner.kiran-ocaisolutions.workers.dev
# Output: 104.21.59.67, 172.67.217.152

dig +short CNAME moltbot-hetzner.kiran-ocaisolutions.workers.dev
# Output: (empty — no CNAME, direct Cloudflare Workers domain)
```

**Finding:** This is a direct Cloudflare Workers domain, not a Cloudflare Tunnel.

---

## 3. Root Cause (Phase 1)

The WSS endpoint is behind **Cloudflare Access (Zero Trust)**. The `websockets` library's connection attempt gets intercepted by Cloudflare, which returns an HTTP 302 redirect to the CF Access login page. The `websockets` library then throws an `InvalidURI` error because the redirect target is an HTTPS URL, not a WSS URL.

The token `8987d3be...` is the **OpenClaw gateway auth token**, not a Cloudflare Access service token. CF Access requires separate credentials.

---

## 4. Code Fix (Phase 1) — CF Access Support

### 4.1 Backend: `api/services/remote_jason.py`

**`RemoteJasonClient.__init__`** — Added `cf_client_id` and `cf_client_secret`:
```python
def __init__(
    self, url, token, session_key="agent:main:main",
    on_event=None,
    cf_client_id=None,      # NEW
    cf_client_secret=None,   # NEW
):
    self.cf_client_id = cf_client_id
    self.cf_client_secret = cf_client_secret
```

**`RemoteJasonClient.connect()`** — Passes CF Access headers + cookie fallback + 15s timeout + error detection:
```python
extra_headers = {}
if self.cf_client_id and self.cf_client_secret:
    extra_headers["CF-Access-Client-Id"] = self.cf_client_id
    extra_headers["CF-Access-Client-Secret"] = self.cf_client_secret
    extra_headers["Cookie"] = f"CF_Authorization={self.cf_client_secret}"
    logger.info("Using Cloudflare Access service token for WSS connection")

try:
    ws = await asyncio.wait_for(
        websockets.connect(self.url, extra_headers=extra_headers or None, ...),
        timeout=15,
    )
except asyncio.TimeoutError:
    raise RuntimeError(
        f"Connection to {self.url} timed out after 15s. "
        "If this endpoint is behind Cloudflare Access, "
        "provide CF-Access-Client-Id and CF-Access-Client-Secret."
    )
except Exception as e:
    if "cloudflareaccess.com" in str(e) or "access/login" in str(e):
        raise RuntimeError(
            "Cloudflare Access is blocking the connection. "
            "Please provide CF-Access-Client-Id and CF-Access-Client-Secret "
            "from your Cloudflare Zero Trust dashboard."
        )
    raise
```

**`RemoteJasonManager.connect()`** — Passes through CF Access fields:
```python
async def connect(self, url, token, session_key="agent:main:main",
                  cf_client_id=None, cf_client_secret=None):
    self._client = RemoteJasonClient(
        url=ws_url, token=token, session_key=session_key,
        cf_client_id=cf_client_id, cf_client_secret=cf_client_secret,
    )
```

### 4.2 Backend: `api/routers/remote.py`

**`RemoteConnectRequest`** — Added CF Access fields:
```python
class RemoteConnectRequest(BaseModel):
    url: str
    token: str
    session_key: str = "agent:main:main"
    cf_client_id: Optional[str] = None      # NEW
    cf_client_secret: Optional[str] = None   # NEW
```

**`/remote/connect`** — Passes CF Access fields:
```python
hello = await remote_jason_manager.connect(
    url=req.url, token=req.token, session_key=req.session_key,
    cf_client_id=req.cf_client_id, cf_client_secret=req.cf_client_secret,
)
```

### 4.3 Frontend: `ui/src/api.ts`

```typescript
export interface RemoteConnectRequest {
    url: string;
    token: string;
    session_key?: string;
    cf_client_id?: string;      // NEW
    cf_client_secret?: string;   // NEW
}
```

### 4.4 Frontend: `ui/src/components/RemoteConfig.tsx`

**New state variables:**
```tsx
const [cfClientId, setCfClientId] = useState('')
const [cfClientSecret, setCfClientSecret] = useState('')
const [showCfSecret, setShowCfSecret] = useState(false)
```

**CF Access fields auto-appear when `wss://` URL is entered:**
```tsx
{url.startsWith('wss://') && (
    <div className="mt-4 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
        <Shield /> Cloudflare Access (Zero Trust)
        <Field label="CF Access Client ID">...</Field>
        <Field label="CF Access Client Secret">...</Field>
    </div>
)}
```

**`handleConnect`** — Passes CF Access fields:
```tsx
await connectRemote({
    url, token, session_key: sessionKey,
    cf_client_id: cfClientId || undefined,
    cf_client_secret: cfClientSecret || undefined,
})
```

### 4.5 Verification (Phase 1)

```bash
# Without CF Access creds — clear error message
curl -s --max-time 20 -X POST http://localhost:8000/api/remote/connect \
  -H 'Content-Type: application/json' \
  -d '{"url":"wss://moltbot-hetzner.kiran-ocaisolutions.workers.dev","token":"8987d3be..."}'
```
**Output:**
```json
{"detail":"Cloudflare Access is blocking the connection. This endpoint requires Cloudflare Access service token credentials. Please provide CF-Access-Client-Id and CF-Access-Client-Secret from your Cloudflare Zero Trust dashboard."}
```

---

## 5. Phase 2 — User Provides CF Access Credentials

User provided:
- **CF-Access-Client-Id:** `37f97556f72e9ae104cd4712ae650601`
- **CF-Access-Client-Secret:** `4e96a491794e111dac801ed8190cc2f09b6e0ffa08ac31ac18370bdca657ae2a`

### 5.1 Test with CF Access service token headers

```bash
curl -sS -o /dev/null -w "HTTP_CODE: %{http_code}" \
  -H "CF-Access-Client-Id: 37f97556f72e9ae104cd4712ae650601" \
  -H "CF-Access-Client-Secret: 4e96a491794e111dac801ed8190cc2f09b6e0ffa08ac31ac18370bdca657ae2a" \
  "https://moltbot-hetzner.kiran-ocaisolutions.workers.dev/"
```
**Output:** `HTTP_CODE: 302` — Still redirecting to CF Access login.

JWT meta still shows `service_token_status: false`.

### 5.2 Test with .access suffix on Client-Id

```bash
curl -sS -o /dev/null -w "HTTP_CODE: %{http_code}" \
  -H "CF-Access-Client-Id: 37f97556f72e9ae104cd4712ae650601.access" \
  -H "CF-Access-Client-Secret: 4e96a491794e111dac801ed8190cc2f09b6e0ffa08ac31ac18370bdca657ae2a" \
  "https://moltbot-hetzner.kiran-ocaisolutions.workers.dev/"
```
**Output:** `HTTP_CODE: 302` — Same redirect.

### 5.3 Test with HTTP/1.1 (some CF workers need this)

```bash
curl -sS --http1.1 -o /dev/null -w "HTTP_CODE: %{http_code}" \
  -H "CF-Access-Client-Id: 37f97556f72e9ae104cd4712ae650601" \
  -H "CF-Access-Client-Secret: 4e96a491794e111dac801ed8190cc2f09b6e0ffa08ac31ac18370bdca657ae2a" \
  "https://moltbot-hetzner.kiran-ocaisolutions.workers.dev/"
```
**Output:** `HTTP_CODE: 302` — Same redirect.

### 5.4 Test with swapped Client-Id and Secret

```bash
curl -sS -o /dev/null -w "HTTP_CODE: %{http_code}" \
  -H "CF-Access-Client-Id: 4e96a491794e111dac801ed8190cc2f09b6e0ffa08ac31ac18370bdca657ae2a" \
  -H "CF-Access-Client-Secret: 37f97556f72e9ae104cd4712ae650601" \
  "https://moltbot-hetzner.kiran-ocaisolutions.workers.dev/"
```
**Output:** `HTTP_CODE: 302` — Same redirect.

### 5.5 Test with Cf-Access-Token combined header

```bash
curl -sS -o /dev/null -w "HTTP_CODE: %{http_code}" \
  -H "Cf-Access-Token: 37f97556f72e9ae104cd4712ae650601.4e96a491794e111dac801ed8190cc2f09b6e0ffa08ac31ac18370bdca657ae2a" \
  "https://moltbot-hetzner.kiran-ocaisolutions.workers.dev/"
```
**Output:** `HTTP_CODE: 302` — Same redirect.

### 5.6 Test with CF_Authorization cookie

```bash
curl -sS -o /dev/null -w "HTTP_CODE: %{http_code}" \
  -H "Cookie: CF_Authorization=37f97556f72e9ae104cd4712ae650601.4e96a491794e111dac801ed8190cc2f09b6e0ffa08ac31ac18370bdca657ae2a" \
  "https://moltbot-hetzner.kiran-ocaisolutions.workers.dev/"
```
**Output:** `HTTP_CODE: 302` — Same redirect.

### 5.7 Test via backend API with CF Access creds

```bash
curl -s --max-time 20 -X POST http://localhost:8000/api/remote/connect \
  -H 'Content-Type: application/json' \
  -d '{"url":"wss://moltbot-hetzner.kiran-ocaisolutions.workers.dev","token":"8987d3be5cb9ffe2d3e0ad5634b1a1bae849e89854b87653aa2580be3f9d21b9","cf_client_id":"37f97556f72e9ae104cd4712ae650601","cf_client_secret":"4e96a491794e111dac801ed8190cc2f09b6e0ffa08ac31ac18370bdca657ae2a"}'
```
**Output:**
```json
{"detail":"Cloudflare Access is blocking the connection. This endpoint requires Cloudflare Access service token credentials. Please provide CF-Access-Client-Id and CF-Access-Client-Secret from your Cloudflare Zero Trust dashboard."}
```

### 5.8 CF Access login page inspection

```bash
curl -sS -L -H "CF-Access-Client-Id: 37f97556f72e9ae104cd4712ae650601" \
  -H "CF-Access-Client-Secret: 4e96a491794e111dac801ed8190cc2f09b6e0ffa08ac31ac18370bdca657ae2a" \
  "https://moltbot-hetzner.kiran-ocaisolutions.workers.dev/" | grep -E "App-name|OrgAvatarLink-title"
```
**Output:**
```
moltbot-sandbox - Cloudflare Access
moltbot-hetzner - Cloudflare Workers
```

The login page shows **email-based OTP** as the only auth method — no service token option visible.

---

## 6. Root Cause (Phase 2)

The CF Access service token credentials (`37f97556...` / `4e96a491...`) are **not being recognized** by Cloudflare Access. Every test returns `service_token_status: false` in the JWT meta.

**Possible reasons:**

| # | Possible Cause | Likelihood |
|---|---------------|------------|
| 1 | Service token not associated with the "moltbot-hetzner" CF Access application | **HIGH** |
| 2 | CF Access policy doesn't have a "Service Auth" rule allowing this token | **HIGH** |
| 3 | Service token is expired or revoked | Medium |
| 4 | Service token was created for a different CF organization | Medium |
| 5 | Header format issue | Low (tested all formats) |

The CF Access login page only shows email-based OTP, which suggests the application policy may not have a **Service Auth** rule configured at all.

---

## 7. Resolution Options

### Option A: Fix CF Access Policy (Recommended)

In the **Cloudflare Zero Trust dashboard**:

1. Go to **Access → Applications**
2. Find the **"moltbot-hetzner"** application
3. Edit the application's **Policy**
4. Add a new policy rule:
   - **Action:** `Service Auth`
   - **Include:** `Service Token` → select the service token by name
5. Save

Then retry the connection from the Aether UI with the same credentials.

### Option B: Create a New Service Token

1. Go to **Access → Service Auth → Service Tokens**
2. Create a **new** service token
3. Copy the **Client ID** and **Client Secret** (shown only once!)
4. Add a **Service Auth** policy rule (as in Option A) for the new token
5. Use the new credentials in the Aether UI

### Option C: Use Browser-Based OTP Login

1. Open `https://moltbot-hetzner.kiran-ocaisolutions.workers.dev/` in a browser
2. Enter your email and complete the OTP login
3. After login, open browser DevTools → Application → Cookies
4. Copy the `CF_Authorization` cookie value
5. Use this JWT as the `CF Access Client Secret` in the Aether UI

### Option D: Disable CF Access

1. Go to **Access → Applications**
2. Find **"moltbot-hetzner"**
3. Disable or delete the CF Access application
4. Connect directly with just the OpenClaw gateway token (no CF Access fields needed)

---

## 8. Files Modified

| File | Change |
|------|--------|
| `api/services/remote_jason.py` | Added `cf_client_id`/`cf_client_secret` to `__init__` and `connect()`; CF Access redirect detection; 15s timeout; cookie fallback |
| `api/routers/remote.py` | Added `cf_client_id`/`cf_client_secret` to `RemoteConnectRequest` and `/connect` endpoint |
| `ui/src/api.ts` | Added `cf_client_id`/`cf_client_secret` to `RemoteConnectRequest` interface |
| `ui/src/components/RemoteConfig.tsx` | Added CF Access input fields (auto-shown for `wss://` URLs), state variables, pass-through |

---

## 9. Infrastructure Summary

| Property | Value |
|----------|-------|
| **Domain** | `moltbot-hetzner.kiran-ocaisolutions.workers.dev` |
| **Type** | Cloudflare Workers (direct, no CNAME/tunnel) |
| **CF Access Org** | `moltbot-sandbox` |
| **CF Access App** | `moltbot-hetzner - Cloudflare Workers` |
| **CF Access AUD** | `ef835860b6b33dda98a19d2e885e05128c89a9cff22b23d4eae30ee08c915e25` |
| **Auth Methods** | Email OTP (service token not configured) |
| **DNS A Records** | `104.21.59.67`, `172.67.217.152` |
| **OpenClaw Token** | `8987d3be5cb9ffe2d3e0ad5634b1a1bae849e89854b87653aa2580be3f9d21b9` |
| **CF Client-Id** | `37f97556f72e9ae104cd4712ae650601` (not recognized) |
| **CF Client-Secret** | `4e96a491794e111dac801ed8190cc2f09b6e0ffa08ac31ac18370bdca657ae2a` (not recognized) |
