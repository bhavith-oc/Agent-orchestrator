# Feature: RunPod Serverless LLM Provider Integration — Feb 16, 2026

> Multi-provider LLM backend support: OpenRouter, RunPod Serverless, and Custom OpenAI-compatible endpoints.
> Full backend + frontend implementation with live provider switching, connection testing, and .env persistence.

---

## Table of Contents

1. [Research Findings](#1-research-findings)
2. [Architecture Overview](#2-architecture-overview)
3. [Backend Implementation](#3-backend-implementation)
4. [Frontend Implementation](#4-frontend-implementation)
5. [Helper Script](#5-helper-script)
6. [End-to-End Testing](#6-end-to-end-testing)
7. [Configuration Guide](#7-configuration-guide)
8. [Troubleshooting](#8-troubleshooting)
9. [Files Changed](#9-files-changed)

---

## 1. Research Findings

### RunPod Serverless vLLM — Key Facts

**Source:** https://docs.runpod.io/serverless/workers/vllm/openai-compatibility

- RunPod Serverless vLLM endpoints are **100% OpenAI-compatible**
- They expose the same `/chat/completions`, `/completions`, and `/models` endpoints
- Authentication uses a standard `Bearer` token in the `Authorization` header
- Base URL format: `https://api.runpod.ai/v2/{ENDPOINT_ID}/openai/v1`
- Model name is the HuggingFace model ID deployed on the endpoint (e.g., `mistralai/Mistral-7B-Instruct-v0.2`)
- Supports streaming and non-streaming responses
- Supports all standard OpenAI parameters: `temperature`, `max_tokens`, `top_p`, `stream`, etc.
- Cold start latency: 10-60s depending on model size and GPU type
- Warm latency: <1s for small models, 1-5s for large models

### OpenAI-Compatible API Pattern

Since RunPod, OpenRouter, Ollama, LM Studio, Together AI, and many others all follow the OpenAI API format, the integration strategy is:

```
┌─────────────────────────────────────────────────────┐
│                  LLMClient                          │
│  ┌───────────┐  ┌───────────┐  ┌───────────────┐   │
│  │ OpenRouter │  │  RunPod   │  │    Custom      │   │
│  │ (default)  │  │ Serverless│  │ (Ollama, etc.) │   │
│  └─────┬─────┘  └─────┬─────┘  └──────┬────────┘   │
│        │              │               │             │
│        ▼              ▼               ▼             │
│   base_url +     base_url +      base_url +        │
│   api_key        api_key +       api_key +          │
│                  endpoint_id     model_name          │
│                  model_name                          │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
              /chat/completions
              (OpenAI format)
```

All three providers use the **same HTTP request format** — only the `base_url`, `api_key`, and `model` differ.

### Python Client Example (from RunPod docs)

```python
from openai import OpenAI

client = OpenAI(
    api_key="RUNPOD_API_KEY",
    base_url="https://api.runpod.ai/v2/ENDPOINT_ID/openai/v1",
)

response = client.chat.completions.create(
    model="mistralai/Mistral-7B-Instruct-v0.2",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Hello!"}
    ],
    temperature=0.7,
    max_tokens=500
)
```

### JavaScript Client Example (from RunPod docs)

```javascript
import { OpenAI } from "openai";

const openai = new OpenAI({
    apiKey: "RUNPOD_API_KEY",
    baseURL: "https://api.runpod.ai/v2/ENDPOINT_ID/openai/v1"
});

const response = await openai.chat.completions.create({
    model: "MODEL_NAME",
    messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello!" }
    ]
});
```

---

## 2. Architecture Overview

### Before (Single Provider)

```
config.py:  OPENROUTER_API_KEY, OPENROUTER_BASE_URL
llm_client.py:  Hardcoded to OpenRouter
jason.py:  Guard checks OPENROUTER_API_KEY only
```

### After (Multi-Provider)

```
config.py:
  LLM_PROVIDER = "openrouter" | "runpod" | "custom"
  OPENROUTER_API_KEY, OPENROUTER_BASE_URL
  RUNPOD_API_KEY, RUNPOD_ENDPOINT_ID, RUNPOD_MODEL_NAME, RUNPOD_BASE_URL
  CUSTOM_LLM_API_KEY, CUSTOM_LLM_BASE_URL, CUSTOM_LLM_MODEL_NAME

llm_client.py:
  _resolve_provider_config() → resolves active provider's config
  LLMClient._reload_config() → hot-reload on provider switch
  LLMClient.is_configured() → checks if active provider has required fields
  LLMClient.test_connection() → tests /models endpoint
  LLMClient.chat() → uses model_override for single-model providers

routers/llm_provider.py:
  GET  /api/llm/provider → current provider info + available providers
  POST /api/llm/provider → switch provider + persist to .env
  POST /api/llm/test     → test connectivity to active provider

jason.py:
  Guard uses llm.is_configured() instead of checking OPENROUTER_API_KEY

RemoteConfig.tsx:
  LLM Provider section with provider tabs, dynamic fields, save + test buttons
```

### Key Design Decisions

1. **No restart required:** Provider switching happens in-memory AND persists to `.env`. The `_reload_config()` method updates the singleton `llm_client` immediately.

2. **model_override:** RunPod and Custom providers serve a single model, so the `model_override` field replaces whatever model name Jason/sub-agents would normally use. OpenRouter passes the model name through unchanged.

3. **Backward compatible:** Default is `openrouter` with the same config keys as before. Existing setups work without any changes.

4. **Timeout increased:** From 120s to 180s to account for RunPod cold starts.

---

## 3. Backend Implementation

### 3.1 config.py — New Settings Fields

**File:** `api/config.py`

**Added fields:**

```python
# LLM Provider Selection: "openrouter" | "runpod" | "custom"
LLM_PROVIDER: str = "openrouter"

# LLM - RunPod Serverless
RUNPOD_API_KEY: str = ""
RUNPOD_ENDPOINT_ID: str = ""  # e.g. "abc123def456" from your RunPod dashboard
RUNPOD_MODEL_NAME: str = ""  # HuggingFace model name, e.g. "mistralai/Mistral-7B-Instruct-v0.2"
RUNPOD_BASE_URL: str = ""  # Auto-built from endpoint ID if empty

# LLM - Custom OpenAI-compatible endpoint
CUSTOM_LLM_API_KEY: str = ""
CUSTOM_LLM_BASE_URL: str = ""  # Any OpenAI-compatible base URL
CUSTOM_LLM_MODEL_NAME: str = ""
```

**Command to verify:**
```bash
grep -E "LLM_PROVIDER|RUNPOD_|CUSTOM_LLM" /root/bhavith/Agent-orchestrator/Agent-orchestrator/api/config.py
```

### 3.2 llm_client.py — Multi-Provider Refactor

**File:** `api/services/llm_client.py`

**Before:** 76 lines, hardcoded to OpenRouter.

**After:** 181 lines, supports 3 providers.

**Key new functions:**

#### `_resolve_provider_config()` — Provider resolution

```python
def _resolve_provider_config() -> dict:
    provider = (settings.LLM_PROVIDER or "openrouter").lower().strip()

    if provider == "runpod":
        api_key = settings.RUNPOD_API_KEY
        endpoint_id = settings.RUNPOD_ENDPOINT_ID
        base_url = settings.RUNPOD_BASE_URL
        if not base_url and endpoint_id:
            base_url = f"https://api.runpod.ai/v2/{endpoint_id}/openai/v1"
        model_override = settings.RUNPOD_MODEL_NAME or None
        return {"provider": "runpod", "base_url": base_url, "api_key": api_key, ...}

    if provider == "custom":
        return {"provider": "custom", "base_url": settings.CUSTOM_LLM_BASE_URL, ...}

    # Default: openrouter
    return {"provider": "openrouter", "base_url": settings.OPENROUTER_BASE_URL, ...}
```

**Why:** Centralizes all provider-specific logic in one function. The rest of LLMClient is provider-agnostic.

#### `LLMClient.is_configured()` — Configuration check

```python
def is_configured(self) -> bool:
    if not self.base_url or not self.api_key:
        return False
    if self.provider == "runpod" and not settings.RUNPOD_ENDPOINT_ID:
        return False
    return True
```

**Why:** Each provider has different required fields. RunPod needs endpoint_id in addition to api_key.

#### `LLMClient.test_connection()` — Connectivity test

```python
async def test_connection(self) -> dict:
    # Calls GET /models on the active provider
    # Returns {"ok": True, "models": [...]} or {"ok": False, "error": "..."}
```

**Why:** Allows the UI to verify connectivity before using the provider for real tasks.

#### `LLMClient.chat()` — Model override

```python
async def chat(self, model, messages, ...):
    effective_model = self.model_override or model  # RunPod/custom override
    payload = {"model": effective_model, "messages": messages, ...}
```

**Why:** RunPod serves a single model per endpoint. The `model_override` ensures the correct model name is sent regardless of what Jason/sub-agents request.

### 3.3 routers/llm_provider.py — New API Router

**File:** `api/routers/llm_provider.py` (NEW)

**Endpoints:**

#### `GET /api/llm/provider`

Returns current provider info and all available provider options with their required fields.

**Command:**
```bash
curl -s http://localhost:8000/api/llm/provider | python3 -m json.tool
```

**Response:**
```json
{
    "provider": "openrouter",
    "base_url": "https://openrouter.ai/api/v1",
    "has_api_key": true,
    "model_override": null,
    "configured": true,
    "available_providers": [
        {
            "id": "openrouter",
            "name": "OpenRouter",
            "description": "OpenRouter.ai — proxy to 200+ models (GPT-4o, Claude, Llama, etc.)",
            "fields": [
                {"key": "OPENROUTER_API_KEY", "label": "API Key", "hint": "sk-or-v1-...", "sensitive": true, "required": true}
            ]
        },
        {
            "id": "runpod",
            "name": "RunPod Serverless",
            "description": "RunPod Serverless vLLM — deploy your own models on GPU (OpenAI-compatible)",
            "fields": [
                {"key": "RUNPOD_API_KEY", "label": "RunPod API Key", "hint": "rpa_...", "sensitive": true, "required": true},
                {"key": "RUNPOD_ENDPOINT_ID", "label": "Endpoint ID", "hint": "abc123def456", "sensitive": false, "required": true},
                {"key": "RUNPOD_MODEL_NAME", "label": "Model Name", "hint": "mistralai/Mistral-7B-Instruct-v0.2", "sensitive": false, "required": true}
            ]
        },
        {
            "id": "custom",
            "name": "Custom OpenAI-Compatible",
            "description": "Any OpenAI-compatible API endpoint (Ollama, LM Studio, Together AI, etc.)",
            "fields": [
                {"key": "CUSTOM_LLM_BASE_URL", "label": "Base URL", "hint": "http://localhost:11434/v1", "sensitive": false, "required": true},
                {"key": "CUSTOM_LLM_API_KEY", "label": "API Key", "hint": "your-api-key", "sensitive": true, "required": true},
                {"key": "CUSTOM_LLM_MODEL_NAME", "label": "Model Name", "hint": "llama3", "sensitive": false, "required": true}
            ]
        }
    ]
}
```

#### `POST /api/llm/provider`

Switch the active provider. Updates in-memory settings AND persists to `.env`.

**Command (switch to RunPod):**
```bash
curl -s -X POST http://localhost:8000/api/llm/provider \
  -H 'Content-Type: application/json' \
  -d '{
    "provider": "runpod",
    "runpod_api_key": "rpa_YOUR_KEY",
    "runpod_endpoint_id": "YOUR_ENDPOINT_ID",
    "runpod_model_name": "mistralai/Mistral-7B-Instruct-v0.2"
  }' | python3 -m json.tool
```

**Response:**
```json
{
    "ok": true,
    "provider": "runpod",
    "configured": true,
    "message": "LLM provider switched to 'runpod'. Configuration saved."
}
```

**Command (switch to custom):**
```bash
curl -s -X POST http://localhost:8000/api/llm/provider \
  -H 'Content-Type: application/json' \
  -d '{
    "provider": "custom",
    "custom_base_url": "http://localhost:11434/v1",
    "custom_api_key": "ollama",
    "custom_model_name": "llama3"
  }' | python3 -m json.tool
```

**Command (switch back to OpenRouter):**
```bash
curl -s -X POST http://localhost:8000/api/llm/provider \
  -H 'Content-Type: application/json' \
  -d '{"provider": "openrouter"}' | python3 -m json.tool
```

#### `POST /api/llm/test`

Test connectivity to the currently active provider by calling `/models`.

**Command:**
```bash
curl -s -X POST http://localhost:8000/api/llm/test | python3 -m json.tool
```

**Response (success):**
```json
{
    "ok": true,
    "provider": "openrouter",
    "models": [
        "qwen/qwen3.5-plus-02-15",
        "anthropic/claude-opus-4.6",
        "openrouter/free",
        ...
    ]
}
```

**Response (failure):**
```json
{
    "ok": false,
    "error": "Connection failed: [Errno 111] Connection refused"
}
```

### 3.4 jason.py — Updated Guard

**File:** `api/services/jason.py`

**Before:**
```python
# Guard: OpenRouter API key must be configured
api_key = settings.OPENROUTER_API_KEY
if not api_key or api_key == "your-openrouter-api-key-here":
    return "⚠️ **OpenRouter API key not configured.**..."
```

**After:**
```python
# Guard: LLM provider must be configured
if not self.llm.is_configured():
    provider = self.llm.provider
    return (
        f"⚠️ **LLM provider '{provider}' is not configured.**\n\n"
        f"Set the required keys in `api/.env` and restart the backend.\n"
        f"Current provider: `LLM_PROVIDER={provider}`\n\n"
        f"Options: `openrouter`, `runpod`, `custom`"
    )
```

**Why:** The guard now works with any provider, not just OpenRouter. It uses `is_configured()` which checks provider-specific requirements.

### 3.5 main.py — Router Registration

**File:** `api/main.py`

```python
from routers import ..., llm_provider
app.include_router(llm_provider.router)
```

---

## 4. Frontend Implementation

### 4.1 api.ts — New Types and Functions

**File:** `ui/src/api.ts`

**New interfaces:**

```typescript
export interface LLMProviderField {
    key: string;
    label: string;
    hint: string;
    sensitive: boolean;
    required: boolean;
}

export interface LLMProviderOption {
    id: string;
    name: string;
    description: string;
    fields: LLMProviderField[];
}

export interface LLMProviderInfo {
    provider: string;
    base_url: string;
    has_api_key: boolean;
    model_override: string | null;
    configured: boolean;
    available_providers: LLMProviderOption[];
}
```

**New functions:**

```typescript
export const fetchLLMProvider = async (): Promise<LLMProviderInfo> => { ... };
export const setLLMProvider = async (data: { provider: string; ... }): Promise<{ ok, provider, configured, message }> => { ... };
export const testLLMConnection = async (): Promise<{ ok, provider?, models?, error? }> => { ... };
```

### 4.2 RemoteConfig.tsx — LLM Provider Section

**File:** `ui/src/components/RemoteConfig.tsx`

**New state variables:**
```typescript
const [llmInfo, setLlmInfo] = useState<LLMProviderInfo | null>(null)
const [llmProvider, setLlmProviderState] = useState('openrouter')
const [llmFields, setLlmFields] = useState<Record<string, string>>({})
const [llmSaving, setLlmSaving] = useState(false)
const [llmTesting, setLlmTesting] = useState(false)
const [llmTestResult, setLlmTestResult] = useState<{...} | null>(null)
const [llmShowSensitive, setLlmShowSensitive] = useState<Record<string, boolean>>({})
```

**New UI section:** "LLM Provider" collapsible section with:
- **Provider selector tabs:** OpenRouter, RunPod Serverless, Custom OpenAI-Compatible
- **Dynamic fields:** Auto-generated from backend `available_providers[].fields`
- **RunPod setup guide:** Inline instructions with links to RunPod console
- **Activate button:** Saves provider config to backend + .env
- **Test Connection button:** Tests /models endpoint and shows available models
- **Status indicator:** Shows active provider, configured state, and base URL

---

## 5. Helper Script

**File:** `helper-function/test_runpod_connection.py`

**Purpose:** Standalone script to test RunPod Serverless connectivity without the full Aether backend.

**Usage:**
```bash
# With command-line arguments
python3 helper-function/test_runpod_connection.py \
  --api-key rpa_YOUR_KEY \
  --endpoint-id YOUR_ENDPOINT_ID \
  --model mistralai/Mistral-7B-Instruct-v0.2

# With environment variables
export RUNPOD_API_KEY=rpa_YOUR_KEY
export RUNPOD_ENDPOINT_ID=YOUR_ENDPOINT_ID
export RUNPOD_MODEL_NAME=mistralai/Mistral-7B-Instruct-v0.2
python3 helper-function/test_runpod_connection.py
```

**Tests performed:**
1. `GET /models` — Lists available models
2. `POST /chat/completions` — Non-streaming chat (asks "What is 2+2?")
3. `POST /chat/completions` (stream=true) — Streaming chat (asks "Say hello in 5 words")

**Example output:**
```
RunPod Serverless vLLM Connection Test
  Base URL:    https://api.runpod.ai/v2/abc123/openai/v1
  Model:       mistralai/Mistral-7B-Instruct-v0.2
  API Key:     rpa_1234...5678

============================================================
TEST 1: List Models (/models)
============================================================
  Status: 200
  Models: ['mistralai/Mistral-7B-Instruct-v0.2']

============================================================
TEST 2: Chat Completion (/chat/completions)
============================================================
  Status: 200
  Latency: 1.23s
  Response: 2 + 2 equals 4.
  Tokens: prompt=23, completion=8, total=31

============================================================
TEST 3: Streaming Chat Completion (stream=true)
============================================================
  Status: 200
    chunk: 'Hello'
    chunk: ','
    chunk: ' how'
    chunk: ' are'
    chunk: ' you'
  Full response: Hello, how are you
  Latency: 0.89s (5 chunks)

============================================================
RESULTS SUMMARY
============================================================
  models: ✅ PASS
  chat: ✅ PASS
  streaming: ✅ PASS

🎉 All tests passed! RunPod endpoint is ready for use.
```

---

## 6. End-to-End Testing

### Test Results Summary

| Test | Command | Result |
|------|---------|--------|
| GET provider info | `curl /api/llm/provider` | ✅ Returns openrouter with 3 available providers |
| Test OpenRouter connection | `curl -X POST /api/llm/test` | ✅ Returns 10 models |
| Switch to RunPod | `curl -X POST /api/llm/provider -d '{"provider":"runpod",...}'` | ✅ Provider switched, configured=true |
| Verify RunPod active | `curl /api/llm/provider` | ✅ Shows runpod, correct base_url |
| Switch to Custom | `curl -X POST /api/llm/provider -d '{"provider":"custom",...}'` | ✅ Provider switched |
| Switch back to OpenRouter | `curl -X POST /api/llm/provider -d '{"provider":"openrouter"}'` | ✅ Restored |
| .env persistence | `grep LLM_PROVIDER api/.env` | ✅ All provider configs persisted |
| TypeScript compilation | `npx tsc --noEmit` | ✅ Zero errors |
| Production build | `npm run build` | ✅ Built in 10.77s |
| Frontend HMR | `journalctl -u aether-frontend` | ✅ No errors |
| Backend health | `curl /api/health` | ✅ OK |

### Detailed Test Commands and Outputs

**Test 1: GET /api/llm/provider**
```bash
curl -s http://localhost:8000/api/llm/provider | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(f'Provider: {d[\"provider\"]}')
print(f'Configured: {d[\"configured\"]}')
print(f'Base URL: {d[\"base_url\"]}')
print(f'Providers: {[p[\"id\"] for p in d[\"available_providers\"]]}')"
```
**Output:**
```
Provider: openrouter
Configured: True
Base URL: https://openrouter.ai/api/v1
Providers: ['openrouter', 'runpod', 'custom']
```

**Test 2: POST /api/llm/test**
```bash
curl -s -X POST http://localhost:8000/api/llm/test | python3 -m json.tool
```
**Output:**
```json
{
    "ok": true,
    "provider": "openrouter",
    "models": ["qwen/qwen3.5-plus-02-15", "anthropic/claude-opus-4.6", ...]
}
```

**Test 3: Switch to RunPod**
```bash
curl -s -X POST http://localhost:8000/api/llm/provider \
  -H 'Content-Type: application/json' \
  -d '{"provider":"runpod","runpod_api_key":"test-key","runpod_endpoint_id":"test-endpoint","runpod_model_name":"mistralai/Mistral-7B-Instruct-v0.2"}' | python3 -m json.tool
```
**Output:**
```json
{"ok": true, "provider": "runpod", "configured": true, "message": "LLM provider switched to 'runpod'. Configuration saved."}
```

**Test 4: Verify RunPod active**
```bash
curl -s http://localhost:8000/api/llm/provider | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(f'Provider: {d[\"provider\"]}')
print(f'Base URL: {d[\"base_url\"]}')
print(f'Model: {d[\"model_override\"]}')"
```
**Output:**
```
Provider: runpod
Base URL: https://api.runpod.ai/v2/test-endpoint/openai/v1
Model: mistralai/Mistral-7B-Instruct-v0.2
```

**Test 5: Switch back to OpenRouter**
```bash
curl -s -X POST http://localhost:8000/api/llm/provider \
  -H 'Content-Type: application/json' \
  -d '{"provider":"openrouter"}' | python3 -c "
import sys,json; d=json.load(sys.stdin); print(f'OK: {d[\"ok\"]}, Provider: {d[\"provider\"]}')"
```
**Output:**
```
OK: True, Provider: openrouter
```

**Test 6: .env persistence**
```bash
grep -E "LLM_PROVIDER|RUNPOD_|CUSTOM_LLM" /root/bhavith/Agent-orchestrator/Agent-orchestrator/api/.env
```
**Output:**
```
LLM_PROVIDER=openrouter
RUNPOD_API_KEY=test-key
RUNPOD_ENDPOINT_ID=test-endpoint
RUNPOD_MODEL_NAME=mistralai/Mistral-7B-Instruct-v0.2
CUSTOM_LLM_BASE_URL=http://localhost:11434/v1
CUSTOM_LLM_API_KEY=ollama
CUSTOM_LLM_MODEL_NAME=llama3
```

---

## 7. Configuration Guide

### Option A: OpenRouter (Default — Recommended for Getting Started)

**What it is:** OpenRouter.ai is a proxy that gives you access to 200+ models (GPT-4o, Claude, Llama, Mistral, etc.) with a single API key.

**Setup:**
1. Go to https://openrouter.ai and create an account
2. Get your API key from https://openrouter.ai/keys
3. Configure:

```bash
# Via API (no restart needed)
curl -s -X POST http://localhost:8000/api/llm/provider \
  -H 'Content-Type: application/json' \
  -d '{"provider":"openrouter","openrouter_api_key":"sk-or-v1-YOUR-KEY"}'

# Or via .env (requires restart)
echo 'LLM_PROVIDER=openrouter' >> api/.env
echo 'OPENROUTER_API_KEY=sk-or-v1-YOUR-KEY' >> api/.env
systemctl restart aether-backend
```

**Pros:** 200+ models, pay-per-token, no GPU needed, instant setup
**Cons:** Depends on external service, per-token cost

### Option B: RunPod Serverless (Recommended for Self-Hosted)

**What it is:** RunPod lets you deploy any HuggingFace model on serverless GPUs. You only pay when the endpoint is processing requests.

**Setup:**

#### Step 1: Create a RunPod Account
1. Go to https://www.runpod.io and sign up
2. Add credits ($10 minimum)

#### Step 2: Create a Serverless Endpoint
1. Go to https://www.runpod.io/console/serverless
2. Click "New Endpoint"
3. Select **vLLM Worker** template
4. Configure:
   - **Model:** Choose a HuggingFace model (e.g., `mistralai/Mistral-7B-Instruct-v0.2`)
   - **GPU:** Select GPU type (A100 for large models, A40/L4 for smaller ones)
   - **Min Workers:** 0 (serverless — scales to zero when idle)
   - **Max Workers:** 1-5 (depending on expected load)
5. Click "Create Endpoint"
6. Wait for the endpoint to be ready (status: "Ready")

#### Step 3: Get Your Credentials
1. **Endpoint ID:** Copy from the endpoint URL (e.g., `abc123def456`)
2. **API Key:** Go to https://www.runpod.io/console/user/settings → API Keys → Create

#### Step 4: Configure in Aether Orchestrator

**Via UI (recommended):**
1. Go to Master Node Deployment page
2. Expand "LLM Provider" section
3. Click "RunPod Serverless" tab
4. Fill in: API Key, Endpoint ID, Model Name
5. Click "Activate RunPod Serverless"
6. Click "Test Connection" to verify

**Via API:**
```bash
curl -s -X POST http://localhost:8000/api/llm/provider \
  -H 'Content-Type: application/json' \
  -d '{
    "provider": "runpod",
    "runpod_api_key": "rpa_YOUR_KEY",
    "runpod_endpoint_id": "YOUR_ENDPOINT_ID",
    "runpod_model_name": "mistralai/Mistral-7B-Instruct-v0.2"
  }'
```

**Via .env:**
```bash
LLM_PROVIDER=runpod
RUNPOD_API_KEY=rpa_YOUR_KEY
RUNPOD_ENDPOINT_ID=YOUR_ENDPOINT_ID
RUNPOD_MODEL_NAME=mistralai/Mistral-7B-Instruct-v0.2
# RUNPOD_BASE_URL is auto-built from ENDPOINT_ID
```

**Pros:** Self-hosted, no data leaves your control, fixed GPU cost, any HuggingFace model
**Cons:** Cold start latency (10-60s), requires RunPod account + credits

#### Recommended RunPod Models

| Model | Size | GPU | Use Case |
|-------|------|-----|----------|
| `mistralai/Mistral-7B-Instruct-v0.2` | 7B | A40/L4 | Fast, good for coding |
| `meta-llama/Meta-Llama-3.1-8B-Instruct` | 8B | A40/L4 | General purpose |
| `meta-llama/Meta-Llama-3.1-70B-Instruct` | 70B | A100 80GB | High quality |
| `Qwen/Qwen2.5-Coder-32B-Instruct` | 32B | A100 40GB | Best for coding tasks |
| `deepseek-ai/DeepSeek-Coder-V2-Instruct` | 236B MoE | A100 80GB x2 | Top coding performance |

### Option C: Custom OpenAI-Compatible (Ollama, LM Studio, etc.)

**What it is:** Any endpoint that speaks the OpenAI API format.

**Examples:**
- **Ollama:** `http://localhost:11434/v1` (local, free)
- **LM Studio:** `http://localhost:1234/v1` (local, free)
- **Together AI:** `https://api.together.xyz/v1` (cloud, pay-per-token)
- **Groq:** `https://api.groq.com/openai/v1` (cloud, fast inference)
- **Any vLLM server:** `http://your-server:8000/v1`

**Setup (Ollama example):**
```bash
# 1. Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# 2. Pull a model
ollama pull llama3

# 3. Configure in Aether
curl -s -X POST http://localhost:8000/api/llm/provider \
  -H 'Content-Type: application/json' \
  -d '{
    "provider": "custom",
    "custom_base_url": "http://localhost:11434/v1",
    "custom_api_key": "ollama",
    "custom_model_name": "llama3"
  }'
```

**Pros:** Fully local, free, no internet needed, full privacy
**Cons:** Requires local GPU, limited to models that fit in your VRAM

---

## 8. Troubleshooting

### Issue: "LLM provider 'runpod' is not configured"

**Check:**
```bash
curl -s http://localhost:8000/api/llm/provider | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(f'Provider: {d[\"provider\"]}')
print(f'Configured: {d[\"configured\"]}')
print(f'Has API Key: {d[\"has_api_key\"]}')"
```

**Fix:** Set all required fields:
```bash
curl -s -X POST http://localhost:8000/api/llm/provider \
  -H 'Content-Type: application/json' \
  -d '{"provider":"runpod","runpod_api_key":"rpa_...","runpod_endpoint_id":"...","runpod_model_name":"..."}'
```

### Issue: RunPod cold start timeout

RunPod serverless endpoints scale to zero when idle. First request after idle period takes 10-60s.

**Fix:** The timeout is already set to 180s. If still timing out:
- Set Min Workers to 1 in RunPod dashboard (keeps one GPU warm, costs more)
- Use a smaller model (7B loads faster than 70B)

### Issue: "Connection failed" on test

```bash
# Test directly with curl
curl -s https://api.runpod.ai/v2/YOUR_ENDPOINT_ID/openai/v1/models \
  -H "Authorization: Bearer YOUR_API_KEY" | python3 -m json.tool
```

If this fails: check API key, endpoint ID, and endpoint status in RunPod dashboard.

### Issue: Wrong model responses

RunPod serves a single model per endpoint. If `RUNPOD_MODEL_NAME` doesn't match the deployed model:
```bash
# Check what model the endpoint actually serves
curl -s https://api.runpod.ai/v2/YOUR_ENDPOINT_ID/openai/v1/models \
  -H "Authorization: Bearer YOUR_API_KEY" | python3 -c "
import sys,json; d=json.load(sys.stdin)
for m in d.get('data',[]): print(m['id'])"
```

### Issue: Provider switch didn't take effect

The switch happens in-memory immediately. But if you restart the backend, it reads from `.env`:
```bash
grep LLM_PROVIDER /root/bhavith/Agent-orchestrator/Agent-orchestrator/api/.env
```

---

## 9. Files Changed

| File | Type | Changes |
|------|------|---------|
| `api/config.py` | Modified | Added `LLM_PROVIDER`, `RUNPOD_*`, `CUSTOM_LLM_*` settings |
| `api/services/llm_client.py` | Modified | Full refactor: `_resolve_provider_config()`, `_reload_config()`, `is_configured()`, `test_connection()`, `model_override` in `chat()` |
| `api/services/jason.py` | Modified | Updated guard to use `llm.is_configured()` instead of checking `OPENROUTER_API_KEY` |
| `api/routers/llm_provider.py` | **New** | `GET /api/llm/provider`, `POST /api/llm/provider`, `POST /api/llm/test` |
| `api/main.py` | Modified | Added `llm_provider` router import and registration |
| `ui/src/api.ts` | Modified | Added `LLMProviderInfo`, `LLMProviderOption`, `LLMProviderField` interfaces + 3 API functions |
| `ui/src/components/RemoteConfig.tsx` | Modified | Added LLM Provider section with provider tabs, dynamic fields, save/test buttons |
| `helper-function/test_runpod_connection.py` | **New** | Standalone RunPod connectivity test script |

### New API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/llm/provider` | Get current provider info + available options |
| POST | `/api/llm/provider` | Switch provider + persist to .env |
| POST | `/api/llm/test` | Test connectivity to active provider |

### Quick Reference Commands

```bash
# Check current provider
curl -s http://localhost:8000/api/llm/provider | python3 -m json.tool

# Test connection
curl -s -X POST http://localhost:8000/api/llm/test | python3 -m json.tool

# Switch to RunPod
curl -s -X POST http://localhost:8000/api/llm/provider \
  -H 'Content-Type: application/json' \
  -d '{"provider":"runpod","runpod_api_key":"KEY","runpod_endpoint_id":"ID","runpod_model_name":"MODEL"}'

# Switch to OpenRouter
curl -s -X POST http://localhost:8000/api/llm/provider \
  -H 'Content-Type: application/json' \
  -d '{"provider":"openrouter","openrouter_api_key":"KEY"}'

# Switch to Custom
curl -s -X POST http://localhost:8000/api/llm/provider \
  -H 'Content-Type: application/json' \
  -d '{"provider":"custom","custom_base_url":"URL","custom_api_key":"KEY","custom_model_name":"MODEL"}'

# Test RunPod independently
python3 helper-function/test_runpod_connection.py --api-key KEY --endpoint-id ID --model MODEL

# Check .env persistence
grep -E "LLM_PROVIDER|RUNPOD_|CUSTOM_LLM" api/.env
```
