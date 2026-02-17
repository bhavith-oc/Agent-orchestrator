"""LLM Provider management API.

Endpoints for querying the active LLM provider, testing connectivity,
switching providers at runtime, and listing available provider options.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from services.llm_client import llm_client
from config import settings
import os, pathlib

router = APIRouter(prefix="/api/llm", tags=["llm-provider"])

_ENV_PATH = pathlib.Path(__file__).resolve().parent.parent / ".env"


class SetProviderRequest(BaseModel):
    provider: str  # "openrouter" | "runpod" | "custom"
    # RunPod fields
    runpod_api_key: Optional[str] = None
    runpod_endpoint_id: Optional[str] = None
    runpod_model_name: Optional[str] = None
    # Custom fields
    custom_base_url: Optional[str] = None
    custom_api_key: Optional[str] = None
    custom_model_name: Optional[str] = None
    # OpenRouter fields
    openrouter_api_key: Optional[str] = None


def _update_env_file(updates: dict[str, str]):
    """Update keys in the .env file, preserving existing content."""
    lines: list[str] = []
    if _ENV_PATH.exists():
        lines = _ENV_PATH.read_text().splitlines()

    updated_keys: set[str] = set()
    new_lines: list[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            key = stripped.split("=", 1)[0].strip()
            if key in updates:
                new_lines.append(f'{key}={updates[key]}')
                updated_keys.add(key)
                continue
        new_lines.append(line)

    # Append any keys that weren't already in the file
    for key, val in updates.items():
        if key not in updated_keys:
            new_lines.append(f'{key}={val}')

    _ENV_PATH.write_text("\n".join(new_lines) + "\n")


@router.get("/provider")
async def get_provider():
    """Get the currently active LLM provider and its configuration."""
    info = llm_client.get_provider_info()
    info["configured"] = llm_client.is_configured()
    info["available_providers"] = [
        {
            "id": "openrouter",
            "name": "OpenRouter",
            "description": "OpenRouter.ai — proxy to 200+ models (GPT-4o, Claude, Llama, etc.)",
            "fields": [
                {"key": "OPENROUTER_API_KEY", "label": "API Key", "hint": "sk-or-v1-...", "sensitive": True, "required": True},
            ],
        },
        {
            "id": "runpod",
            "name": "RunPod Serverless",
            "description": "RunPod Serverless vLLM — deploy your own models on GPU (OpenAI-compatible)",
            "fields": [
                {"key": "RUNPOD_API_KEY", "label": "RunPod API Key", "hint": "rpa_...", "sensitive": True, "required": True},
                {"key": "RUNPOD_ENDPOINT_ID", "label": "Endpoint ID", "hint": "abc123def456", "sensitive": False, "required": True},
                {"key": "RUNPOD_MODEL_NAME", "label": "Model Name", "hint": "mistralai/Mistral-7B-Instruct-v0.2", "sensitive": False, "required": True},
            ],
        },
        {
            "id": "custom",
            "name": "Custom OpenAI-Compatible",
            "description": "Any OpenAI-compatible API endpoint (Ollama, LM Studio, Together AI, etc.)",
            "fields": [
                {"key": "CUSTOM_LLM_BASE_URL", "label": "Base URL", "hint": "http://localhost:11434/v1", "sensitive": False, "required": True},
                {"key": "CUSTOM_LLM_API_KEY", "label": "API Key", "hint": "your-api-key", "sensitive": True, "required": True},
                {"key": "CUSTOM_LLM_MODEL_NAME", "label": "Model Name", "hint": "llama3", "sensitive": False, "required": True},
            ],
        },
    ]
    return info


@router.post("/provider")
async def set_provider(req: SetProviderRequest):
    """Switch the active LLM provider and persist to .env."""
    provider = req.provider.lower().strip()
    if provider not in ("openrouter", "runpod", "custom"):
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}. Use 'openrouter', 'runpod', or 'custom'.")

    env_updates: dict[str, str] = {"LLM_PROVIDER": provider}

    if provider == "runpod":
        if not req.runpod_api_key or not req.runpod_endpoint_id:
            raise HTTPException(status_code=400, detail="RunPod requires runpod_api_key and runpod_endpoint_id.")
        env_updates["RUNPOD_API_KEY"] = req.runpod_api_key
        env_updates["RUNPOD_ENDPOINT_ID"] = req.runpod_endpoint_id
        if req.runpod_model_name:
            env_updates["RUNPOD_MODEL_NAME"] = req.runpod_model_name
        # Update in-memory settings
        settings.LLM_PROVIDER = provider
        settings.RUNPOD_API_KEY = req.runpod_api_key
        settings.RUNPOD_ENDPOINT_ID = req.runpod_endpoint_id
        settings.RUNPOD_MODEL_NAME = req.runpod_model_name or ""

    elif provider == "custom":
        if not req.custom_base_url or not req.custom_api_key:
            raise HTTPException(status_code=400, detail="Custom provider requires custom_base_url and custom_api_key.")
        env_updates["CUSTOM_LLM_BASE_URL"] = req.custom_base_url
        env_updates["CUSTOM_LLM_API_KEY"] = req.custom_api_key
        if req.custom_model_name:
            env_updates["CUSTOM_LLM_MODEL_NAME"] = req.custom_model_name
        settings.LLM_PROVIDER = provider
        settings.CUSTOM_LLM_BASE_URL = req.custom_base_url
        settings.CUSTOM_LLM_API_KEY = req.custom_api_key
        settings.CUSTOM_LLM_MODEL_NAME = req.custom_model_name or ""

    else:  # openrouter
        if req.openrouter_api_key:
            env_updates["OPENROUTER_API_KEY"] = req.openrouter_api_key
            settings.OPENROUTER_API_KEY = req.openrouter_api_key
        settings.LLM_PROVIDER = provider

    # Persist to .env
    _update_env_file(env_updates)

    # Reload the LLM client in-memory
    llm_client._reload_config()

    return {
        "ok": True,
        "provider": provider,
        "configured": llm_client.is_configured(),
        "message": f"LLM provider switched to '{provider}'. Configuration saved.",
    }


@router.post("/test")
async def test_connection():
    """Test connectivity to the currently active LLM provider."""
    result = await llm_client.test_connection()
    return result
