"""
Unit tests for core services — auth helpers, remote_jason client, LLM client.

These test the service layer directly without going through the API router.
They serve as the source of truth for verifying core business logic.
"""

import pytest
import json
from unittest.mock import patch, AsyncMock, MagicMock


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

class TestAuthHelpers:
    """Tests for password hashing, verification, and JWT token creation."""

    def test_hash_password_returns_string(self):
        from routers.auth import hash_password
        hashed = hash_password("testpassword")
        assert isinstance(hashed, str)
        assert len(hashed) > 20

    def test_hash_password_different_each_time(self):
        from routers.auth import hash_password
        h1 = hash_password("same")
        h2 = hash_password("same")
        assert h1 != h2  # bcrypt uses random salt

    def test_verify_password_correct(self):
        from routers.auth import hash_password, verify_password
        hashed = hash_password("mypassword")
        assert verify_password("mypassword", hashed) is True

    def test_verify_password_wrong(self):
        from routers.auth import hash_password, verify_password
        hashed = hash_password("correct")
        assert verify_password("wrong", hashed) is False

    def test_create_access_token(self):
        from routers.auth import create_access_token
        from jose import jwt
        from config import settings

        token = create_access_token({"sub": "user-123"})
        assert isinstance(token, str)

        # Decode and verify
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        assert payload["sub"] == "user-123"
        assert "exp" in payload

    def test_create_access_token_different_data(self):
        from routers.auth import create_access_token
        from jose import jwt
        from config import settings

        token = create_access_token({"sub": "admin-456", "role": "admin"})
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        assert payload["sub"] == "admin-456"
        assert payload["role"] == "admin"


# ---------------------------------------------------------------------------
# LLM Client
# ---------------------------------------------------------------------------

class TestLLMClient:
    """Tests for the LLM client — mocked HTTP calls."""

    @pytest.mark.asyncio
    async def test_chat_sends_correct_payload(self):
        from services.llm_client import LLMClient

        client = LLMClient()
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "choices": [{"message": {"content": "Hello from LLM"}}]
        }
        mock_response.raise_for_status = MagicMock()

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_response) as mock_post:
            result = await client.chat(
                model="test-model",
                messages=[{"role": "user", "content": "Hi"}],
                temperature=0.5,
                max_tokens=100,
            )
            assert result == "Hello from LLM"
            mock_post.assert_called_once()
            call_kwargs = mock_post.call_args
            payload = call_kwargs.kwargs["json"]
            assert payload["model"] == "test-model"
            assert payload["temperature"] == 0.5
            assert payload["max_tokens"] == 100

    @pytest.mark.asyncio
    async def test_chat_json_parses_response(self):
        from services.llm_client import LLMClient

        client = LLMClient()
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "choices": [{"message": {"content": '{"key": "value"}'}}]
        }
        mock_response.raise_for_status = MagicMock()

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_response):
            result = await client.chat_json(
                model="test-model",
                messages=[{"role": "user", "content": "Give me JSON"}],
            )
            assert result == {"key": "value"}

    @pytest.mark.asyncio
    async def test_chat_json_strips_code_fences(self):
        from services.llm_client import LLMClient

        client = LLMClient()
        fenced = '```json\n{"key": "value"}\n```'
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "choices": [{"message": {"content": fenced}}]
        }
        mock_response.raise_for_status = MagicMock()

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_response):
            result = await client.chat_json(
                model="test-model",
                messages=[{"role": "user", "content": "Give me JSON"}],
            )
            assert result == {"key": "value"}


# ---------------------------------------------------------------------------
# Remote Jason Client (unit tests — no real WS connection)
# ---------------------------------------------------------------------------

class TestRemoteJasonManager:
    """Tests for RemoteJasonManager state management."""

    def test_initial_state(self):
        from services.remote_jason import RemoteJasonManager
        mgr = RemoteJasonManager()
        assert mgr.is_connected is False
        assert mgr.client is None
        assert mgr.config is None

    @pytest.mark.asyncio
    async def test_disconnect_when_not_connected(self):
        from services.remote_jason import RemoteJasonManager
        mgr = RemoteJasonManager()
        await mgr.disconnect()  # should not raise
        assert mgr.is_connected is False

    @pytest.mark.asyncio
    async def test_get_info_disconnected(self):
        from services.remote_jason import RemoteJasonManager
        mgr = RemoteJasonManager()
        info = await mgr.get_info()
        assert info["connected"] is False


class TestRemoteJasonClient:
    """Tests for RemoteJasonClient internal logic."""

    def test_client_initial_state(self):
        from services.remote_jason import RemoteJasonClient
        client = RemoteJasonClient(url="ws://test:1234", token="tok", session_key="s:k")
        assert client.url == "ws://test:1234"
        assert client.token == "tok"
        assert client.session_key == "s:k"
        assert client.connected is False

    def test_flush_pending_rejects_all(self):
        import asyncio
        from services.remote_jason import RemoteJasonClient

        client = RemoteJasonClient(url="ws://test:1234", token="tok")
        loop = asyncio.new_event_loop()
        f1 = loop.create_future()
        f2 = loop.create_future()
        client._pending = {"a": f1, "b": f2}
        client._flush_pending("test error")
        assert len(client._pending) == 0
        assert f1.done()
        assert f2.done()
        loop.close()


# ---------------------------------------------------------------------------
# Metrics service
# ---------------------------------------------------------------------------

class TestMetricsService:
    """Tests for the metrics collection service."""

    @pytest.mark.asyncio
    async def test_get_system_metrics(self, db_session):
        from services.metrics import get_system_metrics
        metrics = await get_system_metrics(db_session)
        assert "cpu_percent" in metrics
        assert "memory_used_mb" in metrics
        assert "total_agents" in metrics
        assert metrics["total_agents"] >= 1
        assert 0 <= metrics["cpu_percent"] <= 100


# ---------------------------------------------------------------------------
# Task Planner (mocked LLM)
# ---------------------------------------------------------------------------

class TestTaskPlanner:
    """Tests for the task planner service — mocked LLM."""

    @pytest.mark.asyncio
    async def test_create_task_plan_valid(self):
        from services.task_planner import create_task_plan

        mock_plan = {
            "plan_summary": "Test plan",
            "tasks": [
                {
                    "id": "task-001",
                    "title": "Test task",
                    "description": "Do something",
                    "files_scope": ["test.py"],
                    "depends_on": [],
                    "priority": "General",
                }
            ],
        }

        with patch("services.task_planner.llm_client") as mock_llm:
            mock_llm.chat_json = AsyncMock(return_value=mock_plan)
            result = await create_task_plan("Fix the bug", "src/\n  main.py")
            assert result["plan_summary"] == "Test plan"
            assert len(result["tasks"]) == 1
            assert result["tasks"][0]["id"] == "task-001"

    @pytest.mark.asyncio
    async def test_create_task_plan_invalid_structure(self):
        from services.task_planner import create_task_plan

        with patch("services.task_planner.llm_client") as mock_llm:
            mock_llm.chat_json = AsyncMock(return_value={"bad": "structure"})
            with pytest.raises(ValueError, match="Invalid plan structure"):
                await create_task_plan("Fix the bug", "src/\n  main.py")
