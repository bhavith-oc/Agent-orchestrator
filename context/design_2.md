# Design Document 2 — UI Wiring to New Backend

**Date:** 2026-02-08  
**Phase:** Connect existing React UI to the new Jason orchestrator backend  
**Status:** ✅ UI builds successfully, all components wired to real API endpoints

---

## Summary

This document covers the modifications made to 5 existing UI files to connect the React frontend to the new FastAPI backend. The goal was to replace all hardcoded data and fake responses with real API calls while maintaining backward compatibility with the existing UI design.

---

## Files Modified (in order)

### 1. `ui/src/api.ts` — MODIFIED (complete rewrite)

- **Purpose:** Central API client — all HTTP calls to the backend go through this file
- **Why modified:** The old version only had 6 functions (basic missions + chat). The new backend has 20+ endpoints across auth, agents, missions, chat, and metrics.
- **Changes made:**
  - **Added Axios instance with JWT interceptor** — every request automatically attaches `Bearer {token}` from `localStorage`
  - **Added new TypeScript interfaces:**
    - `ChatSession` — session-based chat model
    - `ChatMessageResponse` — full message with ID, timestamps
    - `AgentInfo` — agent with type, status, model, worktree, load, etc.
    - `AuthResponse` — JWT token + user info
    - `SystemMetrics` — CPU, memory, disk, agent counts
  - **Extended `Mission` interface** — added `parent_mission_id`, `assigned_agent_id`, `git_branch`, `subtasks`
  - **Extended `Message` interface** — added `'system'` role
  - **Added Auth API:** `login()`, `getMe()`, `logout()`
  - **Added Agents API:** `fetchAgents()`, `fetchAgent()`, `terminateAgent()`
  - **Added Session-based Chat API:** `fetchChatSessions()`, `createChatSession()`, `fetchSessionMessages()`, `sendSessionMessage()`
  - **Kept Legacy Chat API:** `fetchChatHistory()`, `sendMessage()` — these still work and now route through Jason
  - **Added Metrics API:** `fetchMetrics()`
  - **Changed `updateMission` signature** — now accepts `Partial<Mission>` instead of `Omit<Mission, 'id'>` for partial updates (status-only drag-drop)
- **Role in architecture:** The single gateway between UI and backend. Every component imports from here.
- **Importance:** 🔴 Critical — breaking this breaks the entire UI

---

### 2. `ui/src/components/Login.tsx` — MODIFIED

- **Purpose:** Authentication screen
- **Why modified:** Was using hardcoded `admin`/`Oc123` check. Now calls real `POST /api/auth/login`.
- **Changes made:**
  - **Added `import { login } from '../api'`**
  - **Added `loading` state** — shows spinner during auth request
  - **Replaced hardcoded credential check** with `await login(username, password)`
    - On success: JWT token stored in `localStorage` via the `login()` function, then `onLogin()` called
    - On failure: Shows error message from backend (`err.response.data.detail`)
  - **Added `Loader2` icon import** for loading spinner
  - **Added `disabled` state** to submit button during loading
- **Role in architecture:** Entry point — user must authenticate before accessing the dashboard
- **Importance:** 🟡 Medium — auth is important but the same credentials (`admin`/`Oc123`) still work since the backend seeds this user on startup

**Before → After:**
```
// BEFORE (hardcoded)
if (username === 'admin' && password === 'Oc123') { onLogin() }

// AFTER (real API)
const response = await login(username, password)  // stores JWT
onLogin()
```

---

### 3. `ui/src/components/Agents.tsx` — MODIFIED (major rewrite)

- **Purpose:** Agents Pool page — shows all active agents with status, load, task info
- **Why modified:** Was 100% hardcoded with 4 fake agents. Now fetches real data from `/api/agents`.
- **Changes made:**
  - **Removed hardcoded `agents` array** (GPT-4, Llama 3, Claude 3, Mistral)
  - **Added state management:** `useState<AgentInfo[]>` for agents, `loading` state
  - **Added `loadAgents()` function** — calls `fetchAgents()` from api.ts
  - **Added auto-refresh** — polls `/api/agents` every 5 seconds via `setInterval`
  - **Added helper functions:** `getStatusStyle()` and `getDotStyle()` — map lowercase status strings (`active`, `busy`, `failed`, `completed`, `offline`) to Tailwind classes
  - **Replaced `agent.role`** with `agent.type === 'master' ? 'Master Orchestrator' : agent.model`
  - **Replaced `agent.task`** with `agent.current_task || 'Idle'`
  - **Replaced `agent.uptime`** with `agent.type` (master/sub) — uptime not tracked yet
  - **Replaced `agent.load`** with `agent.load ?? 0` (nullable safe)
  - **Added loading spinner** while initial fetch is in progress
  - **Replaced "Deploy New Agent" button** with "Refresh" button (agents are spawned by Jason, not manually)
- **Role in architecture:** Real-time visibility into Jason + all sub-agents
- **Importance:** 🟡 Medium — monitoring view, not core functionality

**Data source change:**
```
// BEFORE (hardcoded)
const agents = [
    { id: 'A-01', name: 'GPT-4', role: 'Primary', status: 'Active', task: '...', uptime: '99.9%', load: 45 },
]

// AFTER (dynamic)
const [agents, setAgents] = useState<AgentInfo[]>([])
useEffect(() => { fetchAgents().then(setAgents) }, [])
// Returns: [{ id: '97bfde81', name: 'Jason', type: 'master', status: 'active', model: 'openai/gpt-4o', ... }]
```

---

### 4. `ui/src/components/Chat.tsx` — MODIFIED (major rewrite)

- **Purpose:** Chat interface — user sends messages, Jason responds
- **Why modified:** Had hardcoded agent sidebar and fake `setTimeout` responses. Now uses real API.
- **Changes made:**
  - **Removed hardcoded `agents` array** — replaced with dynamic `fetchAgents()` call
  - **Added `agents` state** — `useState<AgentInfo[]>`, polled every 5 seconds
  - **Added `messagesEndRef`** — auto-scrolls to bottom when new messages arrive
  - **Replaced fake response logic:**
    - **Before:** `setTimeout(() => { setMessages([...prev, fakeResponse]) }, 1000)`
    - **After:** `const response = await sendMessage(newMessage)` — Jason processes the message server-side and returns a real response
  - **Added error handling** — if backend fails, shows helpful error message about checking API key
  - **Added empty state** — when no messages, shows "Send a message to start talking to Jason"
  - **Added typing indicator** — while `sending` is true, shows animated "Processing..." bubble with Jason's name
  - **Updated agent sidebar** — uses `agent.type === 'master'` for primary styling, shows `agent.current_task` as status text
  - **Updated placeholder text** — "Send a command to Jason..." instead of "Synchronize command..."
  - **Updated footer text** — "Messages are processed by Jason via OpenRouter"
  - **Added `whitespace-pre-wrap`** to message bubbles — preserves formatting in Jason's responses (markdown-like output)
  - **Fixed Enter key handling** — `e.shiftKey` check allows Shift+Enter for newlines
- **Role in architecture:** 🔴 THE primary user interaction point. This is where users talk to Jason and trigger the entire orchestration pipeline.
- **Importance:** 🔴 Critical — this is the main interface

**Response flow change:**
```
// BEFORE (fake)
User sends → POST /api/chat/send (just stores) → setTimeout → fake "Aether Core" response

// AFTER (real)
User sends → POST /api/chat/send → Jason receives → LLM plans tasks → spawns agents → returns response
```

---

### 5. `ui/src/App.tsx` — MODIFIED

- **Purpose:** Root app component — layout, sidebar, routing, auth state
- **Why modified:** Needed JWT token persistence and proper logout cleanup
- **Changes made:**
  - **Added `import { logout as apiLogout } from './api'`**
  - **Added `useEffect` import**
  - **Added token check on mount:**
    ```tsx
    useEffect(() => {
        const token = localStorage.getItem('aether_token')
        if (token) setIsAuthenticated(true)
    }, [])
    ```
    This means: if user refreshes the page, they stay logged in (token persists)
  - **Added `handleLogout()` function:**
    ```tsx
    const handleLogout = () => {
        apiLogout()  // clears localStorage token
        setIsAuthenticated(false)
    }
    ```
  - **Replaced inline logout** — `onClick={() => setIsAuthenticated(false)}` → `onClick={handleLogout}`
- **Role in architecture:** App shell — manages auth state and page routing
- **Importance:** 🟡 Medium — small but important changes for auth persistence

---

## No Files Created (UI side)

All changes were modifications to existing files. No new UI files were needed because:
- The existing component structure maps perfectly to the new backend
- Legacy API endpoints maintain backward compatibility
- The `MissionContext.tsx` and `Dashboard.tsx` required **no changes** — they already use `fetchMissions()`, `createMission()`, `updateMission()`, `deleteMission()` which still work with the new backend

---

## Unchanged UI Files

| File | Why No Changes Needed |
|---|---|
| `MissionContext.tsx` | Already calls `fetchMissions()` etc. — new backend serves same shape |
| `Dashboard.tsx` | Uses `useMissions()` context — works transparently |
| `CreateMissionModal.tsx` | Calls `addMission()` from context — works transparently |
| `ComingSoon.tsx` | Static placeholder — no API dependency |
| `main.tsx` | Entry point — no changes needed |
| `index.css` | Styles — no changes needed |

---

## Verification Results

| Test | Result |
|---|---|
| `npm run build` | ✅ Built in 9.20s, no errors |
| TypeScript compilation | ✅ All types match |
| Backend server running | ✅ Port 8000, Jason active |
| `GET /api/health` | ✅ `{"status": "ok"}` |
| `POST /api/auth/login` | ✅ Returns JWT |
| `GET /api/agents` | ✅ Returns Jason |
| `GET /api/missions` | ✅ Returns empty list (clean DB) |
| `GET /api/chat/history` | ✅ Returns empty list (clean session) |

---

## Architecture Flow After Wiring

```
User opens app
  → App.tsx checks localStorage for JWT
  → If no token → Login.tsx → POST /api/auth/login → stores JWT → authenticated

User navigates to Mission Board
  → Dashboard.tsx → MissionContext → GET /api/missions → renders Kanban

User navigates to Agent Hub (Chat)
  → Chat.tsx → GET /api/chat/history (loads existing messages)
  → Chat.tsx → GET /api/agents (loads agent sidebar)
  → User types message → POST /api/chat/send
    → Backend: Jason receives → plans → spawns agents → responds
  → Response displayed in chat bubble

User navigates to Agents Pool
  → Agents.tsx → GET /api/agents → renders agent cards
  → Auto-refreshes every 5 seconds

User clicks Logout
  → App.tsx → apiLogout() → clears JWT → shows Login screen
```

---

## What's Next (design_3.md)

- Test the full end-to-end flow with a real OpenRouter API key
- Verify Jason can plan tasks and spawn sub-agents
- Test git worktree creation and cleanup
- Add WebSocket real-time updates to replace polling
- Build the System Metrics page with live charts
