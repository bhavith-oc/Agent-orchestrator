# Design Document 7 — OpenClaw Remote Configuration UI

**Date:** 2026-02-09  
**Phase:** Allow users to connect to and configure external OpenClaw containers from the Aether UI  
**Status:** ✅ Completed

---

## Objective

Add a **Remote Configuration** panel to the Aether UI that allows users to:
1. Connect to any OpenClaw container by providing URL + token
2. View and edit the container's configuration (model, provider, concurrency, etc.)
3. View and edit the agent's persona files (IDENTITY.md, SOUL.md, etc.)
4. Disconnect from the container

---

## Protocol Discovery — OpenClaw Config API

### RPC Methods Discovered

| Method | Params | Purpose |
|---|---|---|
| `config.get` | `{}` | Returns full config as `{raw, parsed, config, hash, valid, issues, warnings}` |
| `config.set` | `{raw: string, hash: string}` | Replaces entire config. `raw` is JSON string. `hash` from `config.get` for optimistic concurrency. |
| `config.apply` | `{raw: string}` | Merges partial config into existing. `raw` is JSON string of partial config. |
| `agents.files.list` | `{agentId: string}` | Lists agent workspace files with sizes |
| `agents.files.get` | `{agentId: string, name: string}` | Gets file content |
| `agents.files.set` | `{agentId: string, name: string, content: string}` | Sets file content |
| `models.list` | `{}` | Returns all available models (500+ across providers) |

### Current Config Structure (from `config.get`)

```json
{
  "auth": {
    "profiles": {
      "openrouter:default": { "provider": "openrouter", "mode": "api_key" }
    }
  },
  "agents": {
    "defaults": {
      "model": { "primary": "openrouter/x-ai/grok-code-fast-1" },
      "models": {
        "openrouter/x-ai/grok-code-fast-1": { "alias": "grok" },
        "anthropic/claude-opus-4-5": { "alias": "opus" },
        "openai/gpt-5.2": { "alias": "gpt" }
      },
      "workspace": "/home/node/openclaw",
      "compaction": { "mode": "safeguard" },
      "maxConcurrent": 4,
      "subagents": { "maxConcurrent": 8 }
    }
  },
  "gateway": {
    "mode": "local",
    "auth": { "mode": "token", "token": "..." },
    "controlUi": { "allowInsecureAuth": true }
  },
  "channels": {
    "telegram": { "dmPolicy": "allowlist", "allowFrom": ["..."], ... }
  },
  "commands": { "native": "auto", "nativeSkills": "auto" },
  "plugins": { "entries": { "telegram": { "enabled": true } } }
}
```

### Agent Persona Files

OpenClaw agents use markdown files in their workspace as system prompt components:

| File | Purpose | Size on server |
|---|---|---|
| `IDENTITY.md` | Agent's name, role, core identity | 635 bytes |
| `SOUL.md` | Personality, values, communication style | 1673 bytes |
| `AGENTS.md` | Sub-agent definitions and capabilities | 7869 bytes |
| `TOOLS.md` | Available tools and how to use them | 860 bytes |
| `USER.md` | Info about the user/operator | 481 bytes |
| `HEARTBEAT.md` | Periodic heartbeat prompt | 168 bytes |
| `BOOTSTRAP.md` | First-run bootstrap instructions | 1681 bytes |
| `MEMORY.md` | Agent memory (auto-managed) | missing |

These files are read/written via `agents.files.get` / `agents.files.set`.

### Key Findings

1. **`config.set` requires a `hash`** from the previous `config.get` — optimistic concurrency control to prevent conflicting edits
2. **`config.apply` uses `raw` (JSON string)** — merges partial config
3. **`agents.files.set` confirmed working** — `{agentId, name, content}` writes file content
4. **500+ models available** across providers: amazon-bedrock, anthropic, azure-openai, cerebras, github-copilot, openrouter, etc.
5. **Auth profiles** define provider credentials (e.g., `openrouter:default` with `api_key` mode)

---

## UI Design

### New "Remote" Tab in Sidebar

Replace the "Coming Soon" placeholder with a **Remote Configuration** panel containing:

#### Section 1: Connection
- **URL** input (e.g., `ws://72.61.254.5:61816`)
- **Token** input (password field)
- **Session Key** input (default: `agent:main:main`)
- **Connect / Disconnect** button
- **Status indicator** (connected/disconnected with server info)

#### Section 2: Agent Configuration (visible when connected)
- **Primary Model** dropdown (populated from `models.list`, grouped by provider)
- **Model Aliases** — editable list of model aliases
- **Max Concurrent** agents slider
- **Max Concurrent Sub-agents** slider

#### Section 3: Agent Persona (visible when connected)
- Tabbed editor for each persona file:
  - IDENTITY.md, SOUL.md, USER.md, TOOLS.md, HEARTBEAT.md, BOOTSTRAP.md
- Each tab has a textarea with the file content
- Save button per tab

#### Section 4: Auth Profiles (visible when connected)
- Show current auth profiles (provider + mode)
- Allow adding OpenRouter API key

---

## Implementation Plan

### Backend Changes

**`api/services/remote_jason.py`** — Add RPC methods:
- `get_config()` → calls `config.get`
- `set_config(raw, hash)` → calls `config.set`
- `get_agent_files(agent_id)` → calls `agents.files.list`
- `get_agent_file(agent_id, name)` → calls `agents.files.get`
- `set_agent_file(agent_id, name, content)` → calls `agents.files.set`

**`api/routers/remote.py`** — Add endpoints:
- `GET /api/remote/config` — get current config
- `PUT /api/remote/config` — set full config
- `GET /api/remote/agent-files` — list agent files
- `GET /api/remote/agent-files/{name}` — get file content
- `PUT /api/remote/agent-files/{name}` — set file content

### Frontend Changes

**`ui/src/api.ts`** — Add types and functions for config/files API  
**`ui/src/components/RemoteConfig.tsx`** — New component  
**`ui/src/App.tsx`** — Wire into navigation

---

## Implementation — Final Details

### Files Changed

| File | Change |
|---|---|
| `api/services/remote_jason.py` | Added 5 RPC methods: `get_config`, `set_config`, `get_agent_files`, `get_agent_file`, `set_agent_file` |
| `api/routers/remote.py` | Added 5 endpoints: `GET/PUT /config`, `GET /agent-files`, `GET/PUT /agent-files/{name}` + 2 Pydantic schemas |
| `ui/src/api.ts` | Added 3 interfaces (`OpenClawConfig`, `AgentFileInfo`, `AgentFileContent`) + 5 API functions |
| `ui/src/components/RemoteConfig.tsx` | **NEW** — Full config UI with 4 collapsible sections |
| `ui/src/App.tsx` | Replaced Settings `ComingSoon` placeholder with `RemoteConfig` component |
| `api/tests/test_remote.py` | Added 9 new tests (5 endpoint + 4 unit) |

### Test Results

**86/86 tests passing** (9 new for remote config)

New tests:
- `test_remote_config_not_connected` — GET config returns 503
- `test_remote_config_set_not_connected` — PUT config returns 503
- `test_remote_agent_files_list_not_connected` — GET agent-files returns 503
- `test_remote_agent_file_get_not_connected` — GET agent-files/{name} returns 503
- `test_remote_agent_file_set_not_connected` — PUT agent-files/{name} returns 503
- `test_client_has_config_methods` — Client class has all new methods
- `test_get_config_not_connected_raises` — RuntimeError when not connected
- `test_get_agent_files_not_connected_raises` — RuntimeError when not connected
- `test_set_agent_file_not_connected_raises` — RuntimeError when not connected

### Backend Endpoint Verification

```bash
# Config endpoint — returns full OpenClaw config with hash
curl -s http://localhost:8000/api/remote/config | python3 -m json.tool

# Agent files — lists persona files with sizes
curl -s http://localhost:8000/api/remote/agent-files | python3 -m json.tool
```

Both verified working against the live OpenClaw instance at `ws://72.61.254.5:61816`.

### UI Component: RemoteConfig

Located at **Settings** in the sidebar. Contains 4 collapsible sections:

1. **Connection** — URL, token (masked), session key inputs. Connect/disconnect buttons with status badge.
2. **Agent Configuration** — Primary model selector (searchable, grouped by provider, 500+ models), max concurrent agents/sub-agents sliders, model aliases display. Save/reload buttons.
3. **Agent Persona Files** — Tabbed editor for IDENTITY.md, SOUL.md, USER.md, TOOLS.md, AGENTS.md, HEARTBEAT.md, BOOTSTRAP.md. Textarea with unsaved-changes indicator. Save per file.
4. **Server Info** — Raw JSON display of connected server metadata.

### How to Use

1. Navigate to **Settings** in the Aether sidebar
2. Enter the OpenClaw WebSocket URL (e.g., `ws://72.61.254.5:61816`)
3. Enter the gateway auth token
4. Click **Connect**
5. Once connected, the Agent Configuration and Persona Files sections appear
6. Change the primary model, adjust concurrency, or edit persona files
7. Click **Save** to push changes to the remote container
