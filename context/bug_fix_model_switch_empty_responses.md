# Bug Fix: Model Switch — Empty Responses from Claude/DeepSeek

**Date:** 2026-02-09  
**Status:** Resolved

---

## Issue

After switching the OpenClaw primary model from `grok-code-fast-1` to DeepSeek or Claude Sonnet 4, all responses come back with **empty text content** in `chat.history`. The model IS being called (history shows `model: "anthropic/claude-sonnet-4"` or `model: "deepseek/deepseek-chat"`), but the `content` field is `""`.

Grok worked fine (text content present), but had a separate repetition loop issue.

## Timeline of Attempts

| Model ID | Result |
|----------|--------|
| `openrouter/x-ai/grok-code-fast-1` | ✅ Works, but has repetition loop ("Yes. Yes. Yes...") |
| `openrouter/deepseek/deepseek-chat` | ❌ Empty content, model called |
| `openrouter/deepseek/deepseek-v3` | ❌ Empty content, model called |
| `openrouter/deepseek-ai/DeepSeek-V3.2` | ❌ Empty content, timed out |
| `openrouter/anthropic/claude-sonnet-4` | ❌ Empty content, model called |

## OpenClaw Config Format (from Official Docs)

### Model ID Format
Per [OpenClaw OpenRouter docs](https://docs.openclaw.ai/providers/openrouter):
- Format: `openrouter/<provider>/<model>`
- Example: `openrouter/anthropic/claude-sonnet-4-5`
- The `openrouter/` prefix tells OpenClaw to route through OpenRouter
- The auth profile `openrouter:default` with `mode: "api_key"` handles the API key

### Official Config Snippet (from docs)
```json
{
  "env": { "OPENROUTER_API_KEY": "sk-or-..." },
  "agents": {
    "defaults": {
      "model": {
        "primary": "openrouter/anthropic/claude-sonnet-4-5"
      }
    }
  }
}
```

### Community Config Pattern (from gist)
```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/claude-sonnet-4-5",
        "fallbacks": [
          "openrouter/google/gemini-3-flash-preview",
          "openrouter/openai/gpt-5-mini"
        ]
      }
    }
  }
}
```

**Key difference:** The community config uses `anthropic/claude-sonnet-4-5` (no `openrouter/` prefix) for the primary model, suggesting a direct Anthropic API key is configured separately. The `openrouter/` prefix is only for models routed through OpenRouter.

### Current Container Config
```json
{
  "auth": {
    "profiles": {
      "openrouter:default": {
        "provider": "openrouter",
        "mode": "api_key"
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "openrouter/anthropic/claude-sonnet-4"
      },
      "models": { ... },
      "workspace": "/home/node/openclaw",
      "compaction": { "mode": "safeguard" },
      "maxConcurrent": 4,
      "subagents": { "maxConcurrent": 8 }
    }
  }
}
```

**Note:** The official docs show an `env.OPENROUTER_API_KEY` field. Our config does NOT have this — the API key is stored in the auth profile (set via `openclaw onboard`). This may or may not be the issue.

## Root Cause Analysis

### Hypothesis 1: Content in tool_use blocks (not text blocks)
Claude and DeepSeek models emit **tool calls first** (memory_search, web_search, exec, sessions_spawn) before generating text. The text response comes in a **later message** after tool execution. Our `_poll_for_response` was only looking at the entire history, which caused it to find OLD grok responses instead of waiting for new ones.

**Fix applied:** Changed polling to use `baseline_index` — only examines messages AFTER the user's message was sent. This prevents returning stale responses.

**Result:** Still empty — the text content genuinely never appears in the history for these models.

### Hypothesis 2: OpenClaw chat.history doesn't include thinking/tool content
OpenClaw's `chat.history` RPC may only return the **final text content** of each turn, not intermediate tool calls. For models that do extensive tool use before responding, the text might not appear until the agent's full turn completes (which can take minutes for complex tasks).

**Status:** Need to verify by checking raw RPC response structure.

### Hypothesis 3: Model is still processing (tool calls in progress)
The agent might still be executing tool calls when we poll. The empty content message appears immediately (as a placeholder), and the text gets filled in later when the turn completes.

**Status:** Even after 180s timeout, content remains empty. This suggests the model's turn completed but with no text output.

### Hypothesis 4: Model compatibility issue
Some models via OpenRouter may not be fully compatible with OpenClaw's tool-use protocol. Grok worked because it generates text inline with tool calls. Claude/DeepSeek may use a different tool-use format that OpenClaw doesn't fully surface in chat.history.

**Status:** Most likely. Need to test with the OpenClaw chat UI directly to see if responses appear there.

## Code Changes Made

### 1. `api/services/remote_jason.py` — Polling fix
- Changed `_poll_for_response` to use `baseline_index` instead of `old_assistant_count`
- Only examines messages AFTER the user's send point
- Tracks activity (new messages appearing) to extend timeout while agent is working
- Idle detection: if 20+ consecutive polls with no new messages, check for any non-empty content

### 2. `api/services/remote_jason.py` — config.set RPC fix
- Fixed `set_config()` to use `baseHash` parameter name (OpenClaw rejected `hash`)

### 3. `api/routers/remote.py` — Added endpoints
- `POST /api/remote/abort` — Abort stuck generations
- `GET /api/remote/raw-history` — Raw un-normalized history for debugging

### 4. OpenClaw IDENTITY.md — Anti-repetition rules
- Added OUTPUT DISCIPLINE section to prevent grok's "Yes." repetition loop

## Files Modified

| File | Change |
|------|--------|
| `api/services/remote_jason.py` | Polling rewrite (baseline_index), config.set baseHash fix, event gap handling |
| `api/routers/remote.py` | Added /abort and /raw-history endpoints |
| OpenClaw `IDENTITY.md` (remote) | Added OUTPUT DISCIPLINE anti-repetition section |

## Actual Root Cause (RESOLVED)

The `/raw-history` debug endpoint revealed the truth:

```json
{
  "role": "assistant",
  "content": [],
  "model": "anthropic/claude-sonnet-4",
  "stopReason": "error",
  "errorMessage": "402 This request requires more credits, or fewer max_tokens. 
    You requested up to 32000 tokens, but can only afford 30252."
}
```

**The OpenRouter account has insufficient credits for Claude Sonnet 4 and DeepSeek.** These models are more expensive than grok. The `content: []` was because the request was rejected with a 402 before any tokens were generated.

Grok worked because it's a cheaper model that fit within the remaining credit balance.

## Resolution

1. **Switched back to `grok-code-fast-1`** as primary (cheap, works within budget)
2. **Anti-repetition persona fix** already in IDENTITY.md prevents the "Yes." loop
3. **Added error detection** in `_poll_for_response` — now detects `stopReason: "error"` and surfaces the error message immediately instead of waiting 180s for timeout
4. **Added `/raw-history` endpoint** for future debugging of raw OpenClaw RPC responses

### To use Claude/DeepSeek in the future:
- Add more credits at https://openrouter.ai/settings/credits
- Or reduce `max_tokens` in the model config (if OpenClaw supports it)

## Verified Working

```
curl -X POST /api/remote/send -d '{"content":"@jason say hello briefly"}'
→ Model: x-ai/grok-code-fast-1
→ Content: "Hello, how can I help you today?"
→ No repetition loop ✅
```
