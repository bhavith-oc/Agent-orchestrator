from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # Server
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    SECRET_KEY: str = "aether-orchestrator-secret-key-change-in-production"

    # Database
    DATABASE_URL: str = "sqlite+aiosqlite:///./aether.db"

    # LLM Provider Selection: "openrouter" | "runpod" | "custom"
    LLM_PROVIDER: str = "openrouter"

    # LLM - OpenRouter
    OPENROUTER_API_KEY: str = ""
    OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1"

    # LLM - RunPod Serverless
    RUNPOD_API_KEY: str = ""
    RUNPOD_ENDPOINT_ID: str = ""  # e.g. "abc123def456" from your RunPod dashboard
    RUNPOD_MODEL_NAME: str = ""  # HuggingFace model name deployed on RunPod, e.g. "mistralai/Mistral-7B-Instruct-v0.2"
    RUNPOD_BASE_URL: str = ""  # Auto-built from endpoint ID if empty; or set manually for custom vLLM endpoints

    # LLM - Custom OpenAI-compatible endpoint
    CUSTOM_LLM_API_KEY: str = ""
    CUSTOM_LLM_BASE_URL: str = ""  # Any OpenAI-compatible base URL
    CUSTOM_LLM_MODEL_NAME: str = ""

    # Jason Config
    JASON_MODEL: str = "openai/gpt-4o"
    JASON_TEMPERATURE: float = 0.3
    JASON_MAX_TOKENS: int = 4096

    # Sub-Agent Config
    SUB_AGENT_MODEL: str = "openai/gpt-4o-mini"
    SUB_AGENT_TEMPERATURE: float = 0.2
    SUB_AGENT_MAX_TOKENS: int = 8192
    SUB_AGENT_MAX_RETRIES: int = 3

    # Git
    REPO_PATH: str = ""
    WORKTREE_BASE_PATH: str = ""

    # JWT
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 hours
    ALGORITHM: str = "HS256"

    # Remote Jason (OpenClaw)
    REMOTE_JASON_URL: str = ""
    REMOTE_JASON_TOKEN: str = ""
    REMOTE_JASON_SESSION: str = "agent:main:main"

    # Google OAuth
    GOOGLE_CLIENT_ID: str = ""
    AUTH_REQUIRE_GOOGLE: bool = False  # When True, only Google OAuth login is allowed (username/password disabled)
    GOOGLE_ALLOWED_EMAILS: str = ""  # Comma-separated allowlist of emails. Empty = allow all Google accounts

    # Orchestration
    MASTER_DEPLOYMENT_ID: str = ""  # Deployment ID of the master OpenClaw container
    UI_BASE_URL: str = "http://localhost:5173"  # Frontend URL for Telegram links

    # CORS
    CORS_ORIGINS: str = ""

    # Monitoring
    POLL_INTERVAL_SECONDS: float = 2.0

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }


settings = Settings()
