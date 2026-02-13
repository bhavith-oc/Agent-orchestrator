# Browser Debug Flag — Aether Orchestrator UI

## Overview

The Aether Orchestrator UI exposes a `window`-level debug flag that can be set from the browser DevTools console. It lets you switch from the new Onboarding UI to the classic username/password Login form without changing any `.env` files.

**File**: `ui/src/App.tsx`

---

## `window.__AETHER_LEGACY_LOGIN__` — Show Classic Login UI

**Purpose**: Switches the unauthenticated view from the new Onboarding flow to the old username/password Login form.

### Steps

1. Open the app in your browser (e.g., `http://localhost:5173`)
2. Open DevTools → Console (`F12` or `Ctrl+Shift+J`)
3. Run:
   ```js
   window.__AETHER_LEGACY_LOGIN__ = true
   ```
4. Reload the page (`F5` or `Ctrl+R`)
5. The classic Login form will appear instead of the Onboarding flow

### Default Credentials

- **Username**: `admin`
- **Password**: `Oc123`

### To Undo

```js
delete window.__AETHER_LEGACY_LOGIN__
location.reload()
```

### Permanent Alternative

Instead of using the browser flag, you can set `VITE_LEGACY_LOGIN=true` in `ui/.env` and restart the dev server. The browser flag is a quick toggle that doesn't require a server restart.

---

## Notes

- The flag is checked on every render cycle, so after setting it you must reload for the Login component to mount.
- This is a **development convenience** — the classic Login form authenticates against the same backend JWT endpoint.
