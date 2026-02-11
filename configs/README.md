# OpenClaw Configuration Templates

Pre-built configuration templates for one-click agent deployment.

## Files

| File | Description |
|------|-------------|
| `openclaw-default.json` | Single agent (Jason) — minimal setup |
| `openclaw-multi-agent.json` | Multi-agent team (Jason + Researcher + Coder + Reviewer) |

## Usage

### With Docker Compose

Mount the config file into the OpenClaw container by uncommenting the volume mount in `docker-compose.yml`:

```yaml
volumes:
  - ./configs/openclaw-multi-agent.json:/home/node/.openclaw/openclaw.json:ro
```

### With the Web UI

1. Connect to the OpenClaw gateway from the Aether UI
2. Go to **Remote Config → Create New Agent**
3. Fill in Agent ID, Name, Model, and Emoji
4. Click **Create Agent** — the gateway restarts with the new agent

### With the CLI

```bash
# Copy template to OpenClaw config dir
cp configs/openclaw-multi-agent.json ~/.openclaw/openclaw.json

# Or apply via gateway RPC
openclaw gateway call config.set --params "{\"raw\": \"$(cat configs/openclaw-multi-agent.json)\"}"
```

## Custom Configs

Place your own YAML/JSON config files in this directory. The deploy script and Docker Compose stack will pick them up automatically when mounted.

### Agent Entry Format

```json
{
  "id": "my-agent",
  "name": "My Agent",
  "workspace": "~/.openclaw/workspace-my-agent",
  "model": "openrouter/anthropic/claude-sonnet-4",
  "identity": { "name": "My Agent", "emoji": "🤖" },
  "subagents": { "allowAgents": ["*"] }
}
```

### Required Fields

- **`id`** — Unique lowercase identifier (letters, numbers, hyphens)
- **`name`** — Human-readable display name

### Optional Fields

- **`workspace`** — Path to agent workspace (defaults to `~/.openclaw/workspace-{id}`)
- **`model`** — LLM model string (defaults to `agents.defaults.model.primary`)
- **`identity`** — `{ name, emoji }` for chat display
- **`sandbox`** — `{ mode: "all", workspaceAccess: "rw" }` for sandboxed execution
- **`subagents`** — `{ allowAgents: ["*"] }` to allow sub-agent spawning
- **`default`** — `true` to make this the default agent
