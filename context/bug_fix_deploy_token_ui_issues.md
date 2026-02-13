# Bug Fix: Deploy Agent — Token Mismatch, UI Separation, Sidebar Order, Local Mode

**Date:** 2026-02-10
**Status:** Resolved
**Severity:** Mixed (1 blocker, 2 medium, 1 low)

---

## Issues Summary

| # | Issue | Severity | Root Cause |
|---|-------|----------|-----------|
| 1 | Gateway token mismatch — `unauthorized: gateway token mismatch` | Blocker | Heredoc `'MAINEOF'` prevents shell variable expansion |
| 2 | Stopped containers shown in "Active Deployments" | Medium | No separation of running vs stopped |
| 3 | Deploy Agent not at top of sidebar | Low | Nav item was last in the list |
| 4 | Local Agent Hub shows OpenRouter error when unconfigured | Medium | No auto-switch to remote mode |

---

## Issue 1: Gateway Token Mismatch

### Symptom

After deploying via the UI, user copies the gateway token (e.g. `73c38b89a5f3368071958f3b5eb9630d`) and pastes it into the OpenClaw Control UI. Gets error:

```
disconnected (1008): unauthorized: gateway token mismatch
```

### Debugging

**Step 1: Check the .env file has the correct token**

```bash
$ cat /home/oc/Desktop/Agent-orchestrator/deployments/1959c1bfb1/.env
PORT=10188
OPENCLAW_GATEWAY_TOKEN=73c38b89a5f3368071958f3b5eb9630d
```

**Purpose:** Verify the token was written to .env correctly.
**Finding:** Token is correct in .env. The issue must be downstream.

**Step 2: Check what token the container actually has in its config**

```bash
$ sg docker -c "docker exec 1959c1bfb1-openclaw-1 cat /home/node/.openclaw/openclaw.json"
```

**Output (relevant section):**
```json
{
  "gateway": {
    "auth": {
      "mode": "token",
      "token": "$OPENCLAW_GATEWAY_TOKEN"
    },
    "remote": {
      "token": "$OPENCLAW_GATEWAY_TOKEN"
    }
  }
}
```

**Purpose:** Check if the env var was substituted into the JSON config.
**Finding:** The token is the **literal string** `$OPENCLAW_GATEWAY_TOKEN`, NOT the actual value. The shell variable was never expanded.

**Step 3: Trace the variable expansion in docker-compose.yml**

The YAML `command:` block uses heredocs to build `openclaw.json`:

```yaml
# docker-compose.yml line 42 — heredoc with SINGLE-QUOTED delimiter
cat > /home/node/.openclaw/openclaw.json << 'MAINEOF'
...
  "token": "$$OPENCLAW_GATEWAY_TOKEN"
...
MAINEOF
```

**Key insight:** In shell, `<< 'DELIMITER'` (single-quoted) **disables all variable expansion** inside the heredoc. So `$$OPENCLAW_GATEWAY_TOKEN` becomes literal `$OPENCLAW_GATEWAY_TOKEN` — never substituted.

The `$$` is Docker Compose's escape for `$` (to prevent Compose from substituting it). So the chain is:
1. Docker Compose: `$$OPENCLAW_GATEWAY_TOKEN` → `$OPENCLAW_GATEWAY_TOKEN` (passed to shell)
2. Shell heredoc `<< 'MAINEOF'`: `$OPENCLAW_GATEWAY_TOKEN` → `$OPENCLAW_GATEWAY_TOKEN` (NO expansion, literal)
3. Written to JSON: `"token": "$OPENCLAW_GATEWAY_TOKEN"` (wrong!)

**The same bug affects:** `$$TELEGRAM_USER_ID` and `$$WHATSAPP_NUMBER` in their respective heredoc blocks.

### Fix

Added `sed` commands after the JSON file is written to replace placeholder strings with actual env var values:

```yaml
# docker-compose.yml — added after "echo "}" >> openclaw.json"
sed -i "s|\$$OPENCLAW_GATEWAY_TOKEN|$$OPENCLAW_GATEWAY_TOKEN|g" /home/node/.openclaw/openclaw.json
sed -i "s|\$$TELEGRAM_USER_ID|$$TELEGRAM_USER_ID|g" /home/node/.openclaw/openclaw.json
sed -i "s|\$$WHATSAPP_NUMBER|$$WHATSAPP_NUMBER|g" /home/node/.openclaw/openclaw.json
```

These `sed` commands run OUTSIDE the heredoc, so `$$VAR` → `$VAR` → actual value.

Also added to `api/services/deployer.py` `launch()` method: delete old `config/openclaw.json` before launching so the container always regenerates it fresh with the sed fix.

### Verification

```bash
# Stop old container, remove old config, copy fixed YAML, restart
$ sg docker -c "docker compose ... down --remove-orphans"
$ rm -f deployments/1959c1bfb1/config/openclaw.json
$ cp docker-compose.yml deployments/1959c1bfb1/docker-compose.yml
$ sg docker -c "docker compose ... up -d --force-recreate"

# Check the token in the regenerated config
$ sg docker -c "docker exec 1959c1bfb1-openclaw-1 cat /home/node/.openclaw/openclaw.json" | python3 -m json.tool
```

**Output:**
```json
{
  "gateway": {
    "auth": {
      "mode": "token",
      "token": "73c38b89a5f3368071958f3b5eb9630d"
    },
    "remote": {
      "token": "73c38b89a5f3368071958f3b5eb9630d"
    }
  }
}
```

**Result:** Token is now the actual value, not the placeholder.

**Container logs confirm gateway is listening:**
```
[gateway] listening on ws://0.0.0.0:10188 (PID 21)
[ws] webchat connected conn=98c356c8... client=openclaw-control-ui
```

**Files modified:**
- `docker-compose.yml` — Added 3 `sed` commands after JSON generation (lines 172-174)
- `api/services/deployer.py` — Added `old_config.unlink()` in `launch()` to force config regeneration

---

## Issue 2: Active Deployments Shows Stopped Containers

### Symptom

The "Active Deployments" section in the Deploy Agent page shows ALL deployments including stopped ones, with no visual separation.

### Fix

Split the single "Active Deployments" section into two:

1. **Active Deployments** — Only `status === 'running'`, shown with green pulsing dot, emerald border, `defaultOpen={true}`
2. **Inactive Deployments** — Only `status !== 'running'` (stopped/failed/configured), shown with muted styling, `defaultOpen={false}`, `opacity-70`

Each section only renders if it has items.

**File modified:** `ui/src/components/DeployAgent.tsx` — Replaced single deployments list with two filtered sections (lines 403-438)

---

## Issue 3: Deploy Agent Not at Top of Sidebar

### Symptom

Deploy Agent was the last item in the sidebar navigation. User wants it at the top.

### Fix

Moved the `<NavItem icon={Rocket} label="Deploy Agent" ...>` from position 5 to position 1 in the `<nav>` element.

**Before:**
```
1. Mission Board
2. Agent Hub
3. Agents Pool
4. System Metrics
5. Deploy Agent  ← last
```

**After:**
```
1. Deploy Agent  ← first
2. Mission Board
3. Agent Hub
4. Agents Pool
5. System Metrics
```

**File modified:** `ui/src/App.tsx` — Reordered nav items (line 92)

---

## Issue 4: Local Agent Hub Shows OpenRouter Error

### Symptom

When opening Agent Hub, the Local mode is selected by default and shows:

```
OpenRouter API key not configured
Set OPENROUTER_API_KEY in api/.env to enable local Jason.
Try Remote mode instead — it's connected.
```

This is confusing because Remote mode works fine and should be the default when local is unavailable.

### Fix

Two changes in `ui/src/components/Chat.tsx`:

**Fix 4a: Auto-switch to Remote mode**

Added a `useEffect` that detects when local is unconfigured and remote is connected, and automatically switches to remote mode:

```typescript
useEffect(() => {
    if (localStatus && !localStatus.api_key_configured && remoteStatus.connected && mode === 'local') {
        setMode('remote')
    }
}, [localStatus, remoteStatus])
```

**Fix 4b: Disable Local button when unconfigured**

Made the Local mode toggle button:
- Visually grayed out (`bg-slate-800/30 text-slate-600 cursor-not-allowed`)
- Disabled (`disabled={!localStatus?.api_key_configured}`)
- Shows "(N/A)" label
- Has a tooltip explaining how to enable it

**File modified:** `ui/src/components/Chat.tsx` — Added auto-switch useEffect (lines 33-38), updated Local button styling and disabled state (lines 160-174)

---

## All Files Modified

| File | Changes |
|------|---------|
| `docker-compose.yml` | Added 3 `sed` commands to replace heredoc placeholders with actual env var values |
| `api/services/deployer.py` | Added `old_config.unlink()` in `launch()` to force config regeneration on redeploy |
| `ui/src/components/DeployAgent.tsx` | Split deployments into Active (running) and Inactive (stopped) sections |
| `ui/src/App.tsx` | Moved Deploy Agent nav item to top of sidebar |
| `ui/src/components/Chat.tsx` | Auto-switch to remote when local unconfigured; disable Local button with visual indicator |
