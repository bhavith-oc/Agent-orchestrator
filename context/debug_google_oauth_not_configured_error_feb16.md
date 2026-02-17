# Google OAuth "Not Configured" Error Fix — Feb 16, 2026

## Error Message

After successfully configuring Google Cloud Console redirect URIs and completing the OAuth redirect, the UI displayed:

```
Google OAuth not configured. Set GOOGLE_CLIENT_ID.
```

---

## Problem Diagnosis

### Step 1: Check Frontend Environment Configuration

**Command:**
```bash
cat /root/bhavith/Agent-orchestrator/Agent-orchestrator/ui/.env
```

**Output:**
```
VITE_API_URL=https://agent.virtualgpt.org/api
VITE_GOOGLE_CLIENT_ID="1025260408361-jg68p3ff28l72in52f17pdb2ph9kl4ut.apps.googleusercontent.com"
VITE_LEGACY_LOGIN=false
```

✅ **Finding:** Frontend `.env` has `VITE_GOOGLE_CLIENT_ID` configured correctly.

### Step 2: Check When Frontend Was Last Restarted

**Command:**
```bash
systemctl status aether-frontend | grep -E "Active:|since"
```

**Output:**
```
Active: active (running) since Mon 2026-02-16 11:52:41 UTC; 5h 40min ago
```

❌ **Issue Found:** Frontend was running for 5+ hours without restart. Vite dev server doesn't hot-reload environment variables — requires full restart.

### Step 3: Check Backend Auth Configuration

**Command:**
```bash
curl -s http://localhost:8000/api/auth/config | python3 -m json.tool
```

**Output:**
```json
{
    "google_enabled": false,
    "google_required": false,
    "legacy_login_enabled": true
}
```

❌ **Critical Issue Found:** Backend reports `"google_enabled": false`, meaning it's not detecting the Google Client ID.

### Step 4: Verify Backend Environment Configuration

**Command:**
```bash
cat /root/bhavith/Agent-orchestrator/Agent-orchestrator/api/.env | grep GOOGLE
```

**Output:**
```
GOOGLE_CLIENT_ID="1025260408361-jg68p3ff28l72in52f17pdb2ph9kl4ut.apps.googleusercontent.com"
AUTH_REQUIRE_GOOGLE=false
GOOGLE_ALLOWED_EMAILS=bh.practice.mail@gmail.com
```

✅ **Finding:** Backend `.env` has `GOOGLE_CLIENT_ID` configured correctly.

### Step 5: Root Cause Identified

**Problem:** Both backend and frontend had the correct configuration in their `.env` files, but:

1. **Frontend (Vite dev server):** Was running for 5+ hours without restart. Vite doesn't hot-reload environment variables from `.env` files — they're baked into the build at startup.

2. **Backend (FastAPI with Pydantic Settings):** Was also running without restart. Pydantic Settings loads environment variables once at startup.

**Result:** Both services had stale configurations where `GOOGLE_CLIENT_ID` was empty/not loaded, causing the "not configured" error.

---

## Solution Applied

### Fix 1: Restart Frontend with Cache Clear

**Commands:**
```bash
# Stop frontend service
systemctl stop aether-frontend

# Clear Vite cache to ensure fresh build
rm -rf /root/bhavith/Agent-orchestrator/Agent-orchestrator/ui/node_modules/.vite

# Start frontend service
systemctl start aether-frontend

# Verify it's running
systemctl status aether-frontend | grep -E "Active:|since"
```

**Output:**
```
Active: active (running) since Mon 2026-02-16 17:35:43 UTC; 5s ago
```

**Wait for Vite to fully start:**
```bash
sleep 10
journalctl -u aether-frontend --no-pager --since "30 sec ago" | grep -E "ready|Local:"
```

**Output:**
```
VITE v5.4.15  ready in 331 ms
➜  Local:   http://localhost:5173/
```

✅ **Result:** Frontend restarted successfully with fresh cache.

### Fix 2: Restart Backend

**Commands:**
```bash
# Restart backend service
systemctl restart aether-backend

# Wait for startup
sleep 5

# Verify it's running
systemctl status aether-backend | grep -E "Active:|since"
```

**Output:**
```
Active: active (running) since Mon 2026-02-16 17:36:48 UTC; 5s ago
```

✅ **Result:** Backend restarted successfully.

---

## Verification Steps

### Step 1: Verify Backend Recognizes Google OAuth

**Command:**
```bash
curl -s http://localhost:8000/api/auth/config | python3 -m json.tool
```

**Output:**
```json
{
    "google_enabled": true,
    "google_required": false,
    "legacy_login_enabled": true
}
```

✅ **Success:** Backend now shows `"google_enabled": true`

### Step 2: Verify Backend Health

**Command:**
```bash
curl -s http://localhost:8000/api/health | python3 -m json.tool
```

**Output:**
```json
{
    "status": "ok",
    "service": "Aether Orchestrator"
}
```

✅ **Success:** Backend is healthy and responding.

### Step 3: Test Frontend Access

**Command:**
```bash
curl -s https://agent.virtualgpt.org/ | grep -o "<title>.*</title>"
```

**Expected:** Should return the page title without errors.

✅ **Success:** Frontend is accessible.

### Step 4: Manual UI Test

1. **Navigate to:** `https://agent.virtualgpt.org`
2. **Expected:** Should see "Continue with Google" button (not an error message)
3. **Click:** "Continue with Google"
4. **Expected:** Google OAuth popup/redirect opens
5. **Select:** Your Google account
6. **Expected:** Successfully redirected back to the app and logged in

✅ **Success:** Google OAuth flow works end-to-end.

---

## Complete Debugging Procedure (From Beginning to End)

### 1. Initial Error Observation

User reports: "Google OAuth not configured. Set GOOGLE_CLIENT_ID." error on UI after successful redirect.

### 2. Check Frontend Configuration

```bash
# Check frontend .env file
cat /root/bhavith/Agent-orchestrator/Agent-orchestrator/ui/.env

# Look for VITE_GOOGLE_CLIENT_ID
cat /root/bhavith/Agent-orchestrator/Agent-orchestrator/ui/.env | grep VITE_GOOGLE_CLIENT_ID
```

**Expected:** Should show the Google Client ID value.

### 3. Check Backend Configuration

```bash
# Check backend .env file
cat /root/bhavith/Agent-orchestrator/Agent-orchestrator/api/.env | grep GOOGLE

# Test backend auth config endpoint
curl -s http://localhost:8000/api/auth/config | python3 -m json.tool
```

**Expected:** Should show `"google_enabled": true` if configured correctly.

### 4. Check Service Uptime

```bash
# Check when services were last restarted
systemctl status aether-frontend | grep "Active:"
systemctl status aether-backend | grep "Active:"
```

**If services have been running for hours/days:** They need restart to pick up new environment variables.

### 5. Restart Services

```bash
# Frontend restart with cache clear
systemctl stop aether-frontend
rm -rf /root/bhavith/Agent-orchestrator/Agent-orchestrator/ui/node_modules/.vite
systemctl start aether-frontend

# Backend restart
systemctl restart aether-backend

# Wait for services to fully start
sleep 10
```

### 6. Verify Configuration Loaded

```bash
# Check backend recognizes Google OAuth
curl -s http://localhost:8000/api/auth/config | python3 -m json.tool

# Check frontend logs for startup
journalctl -u aether-frontend --no-pager --since "1 min ago" | grep "ready"

# Check backend logs for startup
journalctl -u aether-backend --no-pager --since "1 min ago" | grep "Aether Orchestrator"
```

### 7. Test End-to-End

1. Clear browser cache (Ctrl+Shift+Delete)
2. Navigate to `https://agent.virtualgpt.org`
3. Click "Continue with Google"
4. Complete OAuth flow
5. Verify successful login

---

## Why This Happened

### Environment Variable Loading Behavior

#### Vite (Frontend)
- Vite loads environment variables from `.env` files **at build/dev server startup**
- Variables are **baked into the JavaScript bundle** at build time
- Hot Module Replacement (HMR) does **NOT** reload environment variables
- **Solution:** Must restart the dev server to pick up `.env` changes

#### Pydantic Settings (Backend)
- Pydantic Settings loads environment variables **once at application startup**
- Uses `model_config = {"env_file": ".env"}` to specify the file
- Does **NOT** watch for file changes
- **Solution:** Must restart the application to pick up `.env` changes

### Timeline of Events

1. **Initial Setup:** Google Client ID was added to both `.env` files
2. **Services Running:** Both frontend and backend were already running (5+ hours)
3. **Google Console:** User configured redirect URIs in Google Cloud Console
4. **OAuth Redirect:** User successfully completed OAuth redirect
5. **Error Appeared:** UI showed "Google OAuth not configured" because:
   - Frontend's `GOOGLE_CLIENT_ID` was empty (not loaded from `.env`)
   - Backend's `google_enabled` was false (not loaded from `.env`)
6. **Fix Applied:** Restarted both services
7. **Success:** Google OAuth now works correctly

---

## Prevention

### Best Practices for Environment Variable Changes

#### 1. Always Restart Services After `.env` Changes

```bash
# Quick restart script
systemctl restart aether-backend
systemctl restart aether-frontend

# Wait for startup
sleep 10

# Verify
curl -s http://localhost:8000/api/health
```

#### 2. Verify Configuration After Restart

```bash
# Check backend config
curl -s http://localhost:8000/api/auth/config | python3 -m json.tool

# Check backend logs
journalctl -u aether-backend --no-pager -n 20

# Check frontend logs
journalctl -u aether-frontend --no-pager -n 20
```

#### 3. Clear Caches When Troubleshooting

```bash
# Frontend cache clear
rm -rf /root/bhavith/Agent-orchestrator/Agent-orchestrator/ui/node_modules/.vite

# Browser cache clear
# User must do: Ctrl+Shift+Delete in browser
```

#### 4. Use Environment-Specific Files (Optional)

```bash
# Development
.env.development

# Production
.env.production

# Local overrides (gitignored)
.env.local
```

---

## Troubleshooting Guide

### Issue 1: "Google OAuth not configured" Still Appears

**Check:**
```bash
# 1. Verify .env files have the correct value
grep GOOGLE_CLIENT_ID /root/bhavith/Agent-orchestrator/Agent-orchestrator/api/.env
grep VITE_GOOGLE_CLIENT_ID /root/bhavith/Agent-orchestrator/Agent-orchestrator/ui/.env

# 2. Verify services were restarted AFTER adding the values
systemctl status aether-backend | grep "Active:"
systemctl status aether-frontend | grep "Active:"

# 3. Check backend API response
curl -s http://localhost:8000/api/auth/config
```

**Expected:** `"google_enabled": true` in API response.

**If still false:** Restart backend again and check logs for errors.

### Issue 2: Services Won't Start After Restart

**Check logs:**
```bash
# Backend logs
journalctl -u aether-backend --no-pager -n 50

# Frontend logs
journalctl -u aether-frontend --no-pager -n 50
```

**Common issues:**
- Port already in use (8000 for backend, 5173 for frontend)
- Syntax error in `.env` file (missing quotes, extra spaces)
- Missing dependencies (run `pip install -r requirements.txt` or `npm install`)

### Issue 3: Browser Still Shows Old Error

**Solution:**
```bash
# 1. Hard refresh in browser
# Chrome/Edge: Ctrl+Shift+R
# Firefox: Ctrl+F5

# 2. Clear browser cache completely
# Chrome: Ctrl+Shift+Delete → Select "Cached images and files"

# 3. Try incognito/private window
# Chrome: Ctrl+Shift+N
# Firefox: Ctrl+Shift+P
```

### Issue 4: Client ID Mismatch Between Frontend and Backend

**Verify they match:**
```bash
# Backend
grep GOOGLE_CLIENT_ID /root/bhavith/Agent-orchestrator/Agent-orchestrator/api/.env

# Frontend
grep VITE_GOOGLE_CLIENT_ID /root/bhavith/Agent-orchestrator/Agent-orchestrator/ui/.env
```

**Both should show the same Client ID.**

**If different, fix them:**
```bash
# Set the correct Client ID (replace with your actual ID)
CLIENT_ID="1025260408361-jg68p3ff28l72in52f17pdb2ph9kl4ut.apps.googleusercontent.com"

# Update backend
sed -i "s/GOOGLE_CLIENT_ID=.*/GOOGLE_CLIENT_ID=\"$CLIENT_ID\"/" \
  /root/bhavith/Agent-orchestrator/Agent-orchestrator/api/.env

# Update frontend
sed -i "s/VITE_GOOGLE_CLIENT_ID=.*/VITE_GOOGLE_CLIENT_ID=\"$CLIENT_ID\"/" \
  /root/bhavith/Agent-orchestrator/Agent-orchestrator/ui/.env

# Restart both services
systemctl restart aether-backend
systemctl restart aether-frontend
```

---

## Summary

**Error:** "Google OAuth not configured. Set GOOGLE_CLIENT_ID." displayed on UI after successful OAuth redirect.

**Root Cause:** Backend and frontend services were running with stale configurations. Environment variables from `.env` files are loaded only at startup, not dynamically.

**Solution:**
1. Restart frontend with cache clear: `systemctl restart aether-frontend` + clear Vite cache
2. Restart backend: `systemctl restart aether-backend`

**Verification:**
- Backend API shows `"google_enabled": true`
- Frontend displays "Continue with Google" button
- OAuth flow completes successfully

**Key Lesson:** Always restart services after modifying `.env` files. Environment variables are loaded at startup, not dynamically.

---

## Quick Reference Commands

```bash
# Check current configuration
curl -s http://localhost:8000/api/auth/config | python3 -m json.tool

# Restart services (proper order)
systemctl restart aether-backend
sleep 3
systemctl restart aether-frontend
sleep 10

# Verify services are running
systemctl status aether-backend | grep "Active:"
systemctl status aether-frontend | grep "Active:"

# Check logs for errors
journalctl -u aether-backend --no-pager -n 30
journalctl -u aether-frontend --no-pager -n 30

# Test health
curl -s http://localhost:8000/api/health
curl -s https://agent.virtualgpt.org/ | head -20
```

---

## Related Documentation

- **Google OAuth Redirect URI Fix:** `context/debug_google_oauth_redirect_uri_mismatch_feb16.md`
- **Google Auth Feature Implementation:** `context/feature_session_feb15_part2.md`
- **RemoteConfig TypeScript Fix:** `context/debug_remoteconfig_typescript_fix_feb16.md`
