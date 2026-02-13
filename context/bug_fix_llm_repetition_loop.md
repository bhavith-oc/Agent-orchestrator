# Bug Fix: LLM Repetition Loop in OpenClaw Chat

**Date:** 2026-02-09  
**Status:** Fixed (persona-level mitigation)

---

## Issue

When sending research queries through the OpenClaw chat interface, the `grok-code-fast-1` model enters a **degenerate repetition loop** — generating a valid plan/delegation response, then continuing with endless "Yes." tokens:

```
Step 1 — Plan
Goal restated: Research and provide the latest advancements in LLMs...
...
Worker session set: Researcher (main) + QA (optional).
...
Yes.
Yes.
Yes.
Yes.
(repeats hundreds of times)
```

## Root Cause

The `x-ai/grok-code-fast-1` model (via OpenRouter) is a fast/small model prone to degenerate output when generating long structured responses. After producing the plan and delegation summary, the model fails to emit a proper stop token and instead enters a repetition loop.

**Not a bug in our orchestrator** — this happens at the LLM generation level inside OpenClaw.

## Approaches Tried

### 1. Config `maxTokens` (FAILED)
Attempted to add `maxTokens: 4096` to the OpenClaw config under `agents.defaults.model` and `agents.defaults.models["openrouter/x-ai/grok-code-fast-1"]`. OpenClaw's config schema rejected it as invalid — `maxTokens` is not a supported field at the model config level.

### 2. IDENTITY.md Persona Update (APPLIED ✓)
Added an **OUTPUT DISCIPLINE** section to the IDENTITY.md persona file (Jason's system prompt) with explicit anti-repetition rules:

```markdown
OUTPUT DISCIPLINE (CRITICAL)
- NEVER repeat yourself. Once you state a plan or delegation, STOP.
- Do NOT generate filler like "Yes.", "The answer is...", "The final answer is..." in loops.
- After delegating to sub-agents, your response ENDS with the delegation summary.
- Maximum response length: 500 words for plans, 200 words for status updates.
- If you catch yourself repeating a phrase, STOP IMMEDIATELY and end your response.
- One clear, structured response per turn. No self-dialogue or self-confirmation.
- Format: Plan > Delegate > Brief summary > STOP. Nothing more.
```

### 3. Model Switch (User declined)
Offered to switch primary model to `anthropic/claude-sonnet-4-20250514` which doesn't have this issue. User chose to keep `grok-code-fast-1` with the persona fix.

## Additional Fix: config.set RPC

While investigating, discovered that the `config.set` RPC was broken — our backend was sending `hash` as a parameter name but OpenClaw expects `baseHash`. Fixed in `api/services/remote_jason.py`:

**Before:** `{"raw": raw, "hash": config_hash}`  
**After:** `{"raw": raw, "baseHash": config_hash}` (only when hash is provided)

## Files Modified

| File | Change |
|------|--------|
| `api/services/remote_jason.py` | Fixed `set_config()` to use `baseHash` param name |
| OpenClaw `IDENTITY.md` (remote) | Added OUTPUT DISCIPLINE anti-repetition section |

## Limitations

- Persona-level instructions are a **soft mitigation** — they reduce but cannot guarantee elimination of repetition loops
- The `grok-code-fast-1` model may still occasionally degenerate on very long outputs
- If the issue persists, switching to a more stable model (Claude Sonnet, GPT-4) is recommended
