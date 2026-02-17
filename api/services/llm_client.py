import httpx
import json
import logging
from typing import Optional
from config import settings

logger = logging.getLogger(__name__)


def _resolve_provider_config() -> dict:
    """Resolve the active LLM provider's base_url, api_key, model_override, and headers."""
    provider = (settings.LLM_PROVIDER or "openrouter").lower().strip()

    if provider == "runpod":
        api_key = settings.RUNPOD_API_KEY
        endpoint_id = settings.RUNPOD_ENDPOINT_ID
        base_url = settings.RUNPOD_BASE_URL
        if not base_url and endpoint_id:
            base_url = f"https://api.runpod.ai/v2/{endpoint_id}/openai/v1"
        model_override = settings.RUNPOD_MODEL_NAME or None
        return {
            "provider": "runpod",
            "base_url": base_url,
            "api_key": api_key,
            "model_override": model_override,
            "headers": {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
        }

    if provider == "custom":
        return {
            "provider": "custom",
            "base_url": settings.CUSTOM_LLM_BASE_URL,
            "api_key": settings.CUSTOM_LLM_API_KEY,
            "model_override": settings.CUSTOM_LLM_MODEL_NAME or None,
            "headers": {
                "Authorization": f"Bearer {settings.CUSTOM_LLM_API_KEY}",
                "Content-Type": "application/json",
            },
        }

    # Default: openrouter
    return {
        "provider": "openrouter",
        "base_url": settings.OPENROUTER_BASE_URL,
        "api_key": settings.OPENROUTER_API_KEY,
        "model_override": None,
        "headers": {
            "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:8000",
            "X-Title": "Aether Orchestrator",
        },
    }


class LLMClient:
    """Multi-provider LLM client for Jason and sub-agents.

    Supports:
      - openrouter (default) — OpenRouter.ai proxy to many models
      - runpod — RunPod Serverless vLLM endpoints (OpenAI-compatible)
      - custom — Any OpenAI-compatible endpoint
    """

    def __init__(self):
        self._reload_config()

    def _reload_config(self):
        """(Re)load provider config from settings. Call after env changes."""
        cfg = _resolve_provider_config()
        self.provider = cfg["provider"]
        self.base_url = cfg["base_url"]
        self.api_key = cfg["api_key"]
        self.model_override = cfg["model_override"]
        self.headers = cfg["headers"]
        logger.info(f"LLMClient configured: provider={self.provider}, base_url={self.base_url}")

    def get_provider_info(self) -> dict:
        """Return current provider info for API/UI consumption."""
        return {
            "provider": self.provider,
            "base_url": self.base_url,
            "has_api_key": bool(self.api_key),
            "model_override": self.model_override,
        }

    def is_configured(self) -> bool:
        """Check if the current provider has minimum required configuration."""
        if not self.base_url or not self.api_key:
            return False
        if self.provider == "runpod" and not settings.RUNPOD_ENDPOINT_ID:
            return False
        return True

    async def chat(
        self,
        model: str,
        messages: list[dict],
        temperature: float = 0.3,
        max_tokens: int = 4096,
        response_format: Optional[dict] = None,
    ) -> str:
        """Send a chat completion request to the active LLM provider."""
        # Use model_override for providers that serve a single model (RunPod, custom)
        effective_model = self.model_override or model

        payload = {
            "model": effective_model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if response_format:
            payload["response_format"] = response_format

        async with httpx.AsyncClient(timeout=180.0) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers=self.headers,
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"]

    async def test_connection(self) -> dict:
        """Test connectivity to the active LLM provider. Returns status dict."""
        if not self.is_configured():
            return {"ok": False, "error": f"Provider '{self.provider}' is not fully configured."}
        try:
            # Try listing models first (lightweight)
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    f"{self.base_url}/models",
                    headers=self.headers,
                )
                if response.status_code == 200:
                    data = response.json()
                    models = []
                    if "data" in data:
                        models = [m.get("id", "unknown") for m in data["data"][:10]]
                    return {"ok": True, "provider": self.provider, "models": models}
                else:
                    return {"ok": False, "error": f"HTTP {response.status_code}: {response.text[:200]}"}
        except httpx.ConnectError as e:
            return {"ok": False, "error": f"Connection failed: {str(e)}"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    async def chat_json(
        self,
        model: str,
        messages: list[dict],
        temperature: float = 0.3,
        max_tokens: int = 4096,
    ) -> dict:
        """Send a chat request and parse the response as JSON."""
        raw = await self.chat(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            response_format={"type": "json_object"},
        )
        # Strip markdown code fences if present
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            # Remove first and last lines (code fences)
            lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            cleaned = "\n".join(lines)
        return json.loads(cleaned)


llm_client = LLMClient()
