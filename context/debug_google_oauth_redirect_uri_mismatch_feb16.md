# Google OAuth Redirect URI Mismatch Fix — Feb 16, 2026

## Error Message

```
Access blocked: This app's request is invalid
You can't sign in because this app sent an invalid request. You can try again later, or contact the developer about this issue.

Error 400: redirect_uri_mismatch
```

---

## Problem Diagnosis

### Step 1: Check Current Configuration

**Command:**
```bash
echo "=== Backend .env Google Config ===" && \
grep -E "GOOGLE_CLIENT_ID|GOOGLE_ALLOWED_EMAILS|AUTH_REQUIRE_GOOGLE" \
/root/bhavith/Agent-orchestrator/Agent-orchestrator/api/.env
```

**Output:**
```
=== Backend .env Google Config ===
GOOGLE_CLIENT_ID="1025260408361-jg68p3ff28l72in52f17pdb2ph9kl4ut.apps.googleusercontent.com"
AUTH_REQUIRE_GOOGLE=false
GOOGLE_ALLOWED_EMAILS=bh.practice.mail@gmail.com
```

**Command:**
```bash
echo "=== Frontend .env Google Config ===" && \
grep "VITE_GOOGLE_CLIENT_ID" \
/root/bhavith/Agent-orchestrator/Agent-orchestrator/ui/.env
```

**Output:**
```
=== Frontend .env Google Config ===
VITE_GOOGLE_CLIENT_ID="1025260408361-jg68p3ff28l72in52f17pdb2ph9kl4ut.apps.googleusercontent.com"
```

✅ **Finding:** Google Client ID is configured in both backend and frontend.

### Step 2: Identify the Application Domain

**Command:**
```bash
cat /etc/nginx/sites-enabled/* | grep -E "server_name|proxy_pass" | head -10
```

**Output:**
```
server_name agent.virtualgpt.org;
proxy_pass http://127.0.0.1:5173/landing.html;
proxy_pass http://127.0.0.1:5173;
proxy_pass http://127.0.0.1:8000/api/;
```

✅ **Finding:** The application is accessed via **`https://agent.virtualgpt.org`**

### Step 3: Understand the OAuth Flow

The application uses `@react-oauth/google` library with `useGoogleLogin` hook.

**File:** `ui/src/components/onboarding/GoogleAuthButton.tsx`
```typescript
import { useGoogleLogin } from '@react-oauth/google'

const login = useGoogleLogin({
    onSuccess: (tokenResponse) => onSuccess(tokenResponse.access_token),
    onError: () => onError('Google sign-in was cancelled or failed.'),
})
```

**OAuth Flow:**
1. User clicks "Continue with Google"
2. `useGoogleLogin()` initiates OAuth flow
3. Google redirects to the configured redirect URI
4. App receives the access token

**Default Redirect URIs used by `@react-oauth/google`:**
- For **popup flow**: `postmessage` (special Google value)
- For **redirect flow**: The current page URL (e.g., `https://agent.virtualgpt.org`)

### Step 4: Root Cause Identified

**Error:** `redirect_uri_mismatch`

**Cause:** The Google Cloud Console OAuth 2.0 Client ID does not have the correct **Authorized redirect URIs** configured for the domain `https://agent.virtualgpt.org`.

When the app tries to authenticate, it sends a redirect URI that doesn't match any of the URIs configured in Google Cloud Console, causing Google to reject the request with a 400 error.

---

## Solution: Configure Authorized Redirect URIs in Google Cloud Console

### Step-by-Step Fix

#### 1. Access Google Cloud Console

1. Go to: https://console.cloud.google.com/
2. Sign in with your Google account
3. Select your project (or create one if needed)

#### 2. Navigate to OAuth Credentials

1. In the left sidebar, click **"APIs & Services"** → **"Credentials"**
2. Find your OAuth 2.0 Client ID: `1025260408361-jg68p3ff28l72in52f17pdb2ph9kl4ut.apps.googleusercontent.com`
3. Click on the Client ID name to edit it

#### 3. Add Authorized JavaScript Origins

In the **"Authorized JavaScript origins"** section, add:

```
https://agent.virtualgpt.org
```

**Why:** This tells Google that JavaScript code from this domain is allowed to initiate OAuth requests.

#### 4. Add Authorized Redirect URIs

In the **"Authorized redirect URIs"** section, add **ALL** of the following:

```
https://agent.virtualgpt.org
https://agent.virtualgpt.org/
https://agent.virtualgpt.org/app
https://agent.virtualgpt.org/app/
```

**Why:** 
- The `@react-oauth/google` library may use different redirect paths depending on the flow
- Having multiple variations ensures compatibility
- The trailing slash variants are important for some OAuth implementations

#### 5. For Development/Testing (Optional)

If you also test on localhost, add these as well:

**Authorized JavaScript origins:**
```
http://localhost:5173
http://localhost:3000
```

**Authorized redirect URIs:**
```
http://localhost:5173
http://localhost:5173/
http://localhost:3000
http://localhost:3000/
```

#### 6. Save Changes

1. Click **"Save"** at the bottom of the page
2. Wait 5-10 minutes for changes to propagate (Google's OAuth servers need time to sync)

---

## Verification Steps

### Step 1: Wait for Propagation

**Important:** Google OAuth configuration changes can take **5-10 minutes** to propagate globally. Wait before testing.

```bash
echo "Waiting for Google OAuth config to propagate..."
sleep 300  # Wait 5 minutes
echo "Ready to test!"
```

### Step 2: Clear Browser Cache

Before testing, clear your browser's cache and cookies for `agent.virtualgpt.org`:

**Chrome/Edge:**
1. Press `F12` to open DevTools
2. Right-click the refresh button
3. Select "Empty Cache and Hard Reload"

**Firefox:**
1. Press `Ctrl+Shift+Delete`
2. Select "Cookies" and "Cache"
3. Click "Clear Now"

### Step 3: Test Google Login

1. Navigate to: `https://agent.virtualgpt.org`
2. Click "Continue with Google"
3. Select your Google account
4. Grant permissions if prompted
5. Verify you're redirected back and logged in

**Expected Result:** ✅ Login succeeds, no redirect_uri_mismatch error

### Step 4: Check Backend Logs

**Command:**
```bash
journalctl -u aether-backend --no-pager -n 20 | grep -i "google\|oauth\|login"
```

**Expected Output:**
```
INFO: POST /api/auth/google/login - 200 OK
```

### Step 5: Verify Auth Config Endpoint

**Command:**
```bash
curl -s http://localhost:8000/api/auth/config | python3 -m json.tool
```

**Expected Output:**
```json
{
    "google_enabled": true,
    "google_required": false,
    "legacy_login_enabled": true
}
```

---

## Troubleshooting

### Issue 1: Still Getting redirect_uri_mismatch After 10 Minutes

**Solution:** Double-check the URIs in Google Console

1. Go back to Google Cloud Console → Credentials
2. Verify **EXACTLY** these URIs are listed:
   - `https://agent.virtualgpt.org`
   - `https://agent.virtualgpt.org/`
3. Check for typos (common mistakes: `http` instead of `https`, extra spaces)
4. Save again and wait another 5 minutes

### Issue 2: "Access blocked: This app is not verified"

**Solution:** This is different from redirect_uri_mismatch

1. In Google Cloud Console, go to **"OAuth consent screen"**
2. Add your email to **"Test users"** section
3. Or publish the app (requires verification for production)

### Issue 3: Client ID Mismatch

**Verify the Client IDs match:**

```bash
# Backend
grep GOOGLE_CLIENT_ID /root/bhavith/Agent-orchestrator/Agent-orchestrator/api/.env

# Frontend
grep VITE_GOOGLE_CLIENT_ID /root/bhavith/Agent-orchestrator/Agent-orchestrator/ui/.env
```

Both should show: `1025260408361-jg68p3ff28l72in52f17pdb2ph9kl4ut.apps.googleusercontent.com`

If they don't match, fix them:

```bash
# Update backend
sed -i 's/GOOGLE_CLIENT_ID=.*/GOOGLE_CLIENT_ID="YOUR-CLIENT-ID-HERE"/' \
  /root/bhavith/Agent-orchestrator/Agent-orchestrator/api/.env

# Update frontend
sed -i 's/VITE_GOOGLE_CLIENT_ID=.*/VITE_GOOGLE_CLIENT_ID="YOUR-CLIENT-ID-HERE"/' \
  /root/bhavith/Agent-orchestrator/Agent-orchestrator/ui/.env

# Restart services
systemctl restart aether-backend
systemctl restart aether-frontend
```

### Issue 4: CORS Errors

If you see CORS errors in browser console:

**Check nginx config:**
```bash
cat /etc/nginx/sites-enabled/* | grep -A 5 "add_header"
```

**Expected:** Should have CORS headers configured for API routes.

---

## Complete Configuration Checklist

### Google Cloud Console

- [ ] OAuth 2.0 Client ID created
- [ ] **Authorized JavaScript origins** includes:
  - [ ] `https://agent.virtualgpt.org`
- [ ] **Authorized redirect URIs** includes:
  - [ ] `https://agent.virtualgpt.org`
  - [ ] `https://agent.virtualgpt.org/`
  - [ ] `https://agent.virtualgpt.org/app`
  - [ ] `https://agent.virtualgpt.org/app/`
- [ ] OAuth consent screen configured
- [ ] Test user added (your email)
- [ ] Changes saved
- [ ] Waited 5-10 minutes for propagation

### Backend Configuration

- [ ] `GOOGLE_CLIENT_ID` set in `api/.env`
- [ ] `GOOGLE_ALLOWED_EMAILS` set (comma-separated)
- [ ] `AUTH_REQUIRE_GOOGLE` set to `true` or `false`
- [ ] Backend restarted: `systemctl restart aether-backend`

### Frontend Configuration

- [ ] `VITE_GOOGLE_CLIENT_ID` set in `ui/.env` (matches backend)
- [ ] Frontend restarted: `systemctl restart aether-frontend`
- [ ] Browser cache cleared

### Testing

- [ ] Can access `https://agent.virtualgpt.org`
- [ ] "Continue with Google" button appears
- [ ] Clicking button opens Google login popup/redirect
- [ ] No `redirect_uri_mismatch` error
- [ ] Successfully redirected back after login
- [ ] User is authenticated in the app

---

## Summary

**Problem:** `Error 400: redirect_uri_mismatch` when trying to login with Google

**Root Cause:** Google Cloud Console OAuth 2.0 Client ID did not have the correct Authorized redirect URIs configured for `https://agent.virtualgpt.org`

**Solution:** Add the following to Google Cloud Console → Credentials → OAuth 2.0 Client ID:

**Authorized JavaScript origins:**
- `https://agent.virtualgpt.org`

**Authorized redirect URIs:**
- `https://agent.virtualgpt.org`
- `https://agent.virtualgpt.org/`
- `https://agent.virtualgpt.org/app`
- `https://agent.virtualgpt.org/app/`

**Wait Time:** 5-10 minutes for Google's OAuth servers to propagate changes

**Verification:** Clear browser cache, test login flow, check for successful authentication

---

## Additional Notes

### Why Multiple Redirect URIs?

Different OAuth flows and libraries may use different redirect paths:
- Base domain: `https://agent.virtualgpt.org`
- With trailing slash: `https://agent.virtualgpt.org/`
- App route: `https://agent.virtualgpt.org/app`
- App route with slash: `https://agent.virtualgpt.org/app/`

Having all variants ensures maximum compatibility.

### Security Considerations

1. **Only add trusted domains** to Authorized JavaScript origins
2. **Keep GOOGLE_CLIENT_ID public** (it's meant to be public)
3. **Never expose GOOGLE_CLIENT_SECRET** (not used in this app's implicit flow)
4. **Use GOOGLE_ALLOWED_EMAILS** to restrict who can login
5. **Enable AUTH_REQUIRE_GOOGLE=true** to enforce Google auth only

### For Production

1. Publish the OAuth consent screen (requires Google verification)
2. Add your production domain to Authorized origins/redirect URIs
3. Use environment-specific Client IDs (dev vs prod)
4. Monitor OAuth errors in backend logs
5. Set up proper error handling and user feedback

---

## Quick Reference Commands

```bash
# Check current config
grep GOOGLE /root/bhavith/Agent-orchestrator/Agent-orchestrator/api/.env
grep VITE_GOOGLE /root/bhavith/Agent-orchestrator/Agent-orchestrator/ui/.env

# Test auth config endpoint
curl -s http://localhost:8000/api/auth/config | python3 -m json.tool

# Check backend logs for OAuth errors
journalctl -u aether-backend --no-pager -n 50 | grep -i "google\|oauth\|error"

# Restart services after config changes
systemctl restart aether-backend
systemctl restart aether-frontend

# Check service status
systemctl status aether-backend
systemctl status aether-frontend
```
