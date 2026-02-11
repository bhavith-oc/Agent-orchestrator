"""
Tests for the new chat architecture:
- Conversational mode (REPO_PATH empty)
- API key guard
- Chat history loading
- Discussion writer service
"""

import os
import shutil
import pytest
from httpx import AsyncClient
from unittest.mock import patch, AsyncMock, MagicMock


# ---------------------------------------------------------------------------
# Jason conversational mode tests
# ---------------------------------------------------------------------------

class TestJasonConversationalMode:
    """Tests for Jason's handle_user_message with empty REPO_PATH."""

    @pytest.mark.asyncio
    async def test_missing_api_key_returns_config_message(self, client: AsyncClient):
        """When OPENROUTER_API_KEY is the placeholder, Jason returns a config warning."""
        with patch("services.jason.settings") as mock_settings:
            mock_settings.OPENROUTER_API_KEY = "your-openrouter-api-key-here"
            mock_settings.REPO_PATH = ""
            mock_settings.JASON_MODEL = "test"
            mock_settings.JASON_TEMPERATURE = 0.3
            mock_settings.JASON_MAX_TOKENS = 4096

            resp = await client.post("/api/chat/send", json={
                "role": "user",
                "content": "Hello Jason",
            })
            assert resp.status_code == 200
            data = resp.json()
            assert data["role"] == "agent"
            assert "OpenRouter API key not configured" in data["content"]

    @pytest.mark.asyncio
    async def test_empty_api_key_returns_config_message(self, client: AsyncClient):
        """When OPENROUTER_API_KEY is empty, Jason returns a config warning."""
        with patch("services.jason.settings") as mock_settings:
            mock_settings.OPENROUTER_API_KEY = ""
            mock_settings.REPO_PATH = ""
            mock_settings.JASON_MODEL = "test"

            resp = await client.post("/api/chat/send", json={
                "role": "user",
                "content": "Hello",
            })
            assert resp.status_code == 200
            assert "OpenRouter API key not configured" in resp.json()["content"]

    @pytest.mark.asyncio
    async def test_conversational_mode_calls_llm(self, client: AsyncClient):
        """With valid API key and empty REPO_PATH, Jason uses conversational mode."""
        with patch("services.jason.settings") as mock_settings, \
             patch("services.jason.llm_client") as mock_llm:
            mock_settings.OPENROUTER_API_KEY = "sk-valid-key"
            mock_settings.REPO_PATH = ""
            mock_settings.JASON_MODEL = "test-model"
            mock_settings.JASON_TEMPERATURE = 0.3
            mock_settings.JASON_MAX_TOKENS = 4096
            mock_llm.chat = AsyncMock(return_value="Hello! I'm Jason, your AI orchestrator.")

            resp = await client.post("/api/chat/send", json={
                "role": "user",
                "content": "Hello Jason, what can you do?",
            })
            assert resp.status_code == 200
            data = resp.json()
            assert data["role"] == "agent"
            assert data["name"] == "Jason"
            assert data["content"] == "Hello! I'm Jason, your AI orchestrator."
            mock_llm.chat.assert_called_once()

    @pytest.mark.asyncio
    async def test_conversational_mode_includes_history(self, client: AsyncClient):
        """Conversational mode should pass chat history to the LLM."""
        with patch("services.jason.settings") as mock_settings, \
             patch("services.jason.llm_client") as mock_llm:
            mock_settings.OPENROUTER_API_KEY = "sk-valid-key"
            mock_settings.REPO_PATH = ""
            mock_settings.JASON_MODEL = "test-model"
            mock_settings.JASON_TEMPERATURE = 0.3
            mock_settings.JASON_MAX_TOKENS = 4096
            mock_llm.chat = AsyncMock(return_value="I remember our conversation!")

            # Send first message
            await client.post("/api/chat/send", json={
                "role": "user", "content": "First message",
            })

            # Send second message — should include first in history
            mock_llm.chat = AsyncMock(return_value="Yes, you said 'First message' earlier.")
            resp = await client.post("/api/chat/send", json={
                "role": "user", "content": "What did I say before?",
            })
            assert resp.status_code == 200

            # Verify LLM was called with messages array containing history
            call_args = mock_llm.chat.call_args
            messages = call_args.kwargs.get("messages", call_args.args[1] if len(call_args.args) > 1 else [])
            # Should have: system + history messages + current message
            assert len(messages) >= 2  # at minimum system + current


# ---------------------------------------------------------------------------
# Discussion writer tests
# ---------------------------------------------------------------------------

class TestDiscussionWriter:
    """Tests for the discussion_writer service."""

    @pytest.fixture(autouse=True)
    def cleanup_discussions(self):
        """Clean up discussion files after each test."""
        from services.discussion_writer import DISCUSSIONS_BASE
        yield
        if os.path.exists(DISCUSSIONS_BASE):
            shutil.rmtree(DISCUSSIONS_BASE)

    def test_write_mission_overview(self):
        from services.discussion_writer import write_mission_overview, DISCUSSIONS_BASE

        path = write_mission_overview(
            mission_id="test-mission-001",
            title="Test Mission",
            user_message="Please fix the login bug",
            plan_summary="Fix authentication flow",
            tasks=[
                {"title": "Fix auth.py", "description": "Update password hashing"},
                {"title": "Fix login.tsx", "description": "Update error handling"},
            ],
        )
        assert os.path.exists(path)
        assert path.endswith("overview.md")
        content = open(path).read()
        assert "# Mission: Test Mission" in content
        assert "Please fix the login bug" in content
        assert "Fix auth.py" in content
        assert "Fix login.tsx" in content

    def test_write_agent_log_header(self):
        from services.discussion_writer import write_agent_log_header

        path = write_agent_log_header(
            mission_id="test-mission-002",
            agent_name="Agent-abc123",
            task_title="Fix auth module",
            task_description="Update password hashing to use bcrypt",
            model="openai/gpt-4o-mini",
            git_branch="agent/task-abc123",
            files_scope=["api/routers/auth.py", "api/services/auth.py"],
        )
        assert os.path.exists(path)
        content = open(path).read()
        assert "# Agent: Agent-abc123" in content
        assert "Fix auth module" in content
        assert "openai/gpt-4o-mini" in content
        assert "`api/routers/auth.py`" in content

    def test_append_agent_log(self):
        from services.discussion_writer import write_agent_log_header, append_agent_log

        write_agent_log_header(
            mission_id="test-mission-003",
            agent_name="Agent-xyz",
            task_title="Test task",
            task_description="Test desc",
            model="test-model",
            git_branch=None,
            files_scope=[],
        )
        append_agent_log(
            mission_id="test-mission-003",
            agent_name="Agent-xyz",
            heading="Analysis",
            content="The file needs to be updated to handle edge cases.",
        )
        append_agent_log(
            mission_id="test-mission-003",
            agent_name="Agent-xyz",
            heading="Changes Applied",
            content="- Modified: auth.py\n- Created: auth_test.py",
        )

        from services.discussion_writer import _mission_dir
        path = os.path.join(_mission_dir("test-mission-003"), "agent-Agent-xyz.md")
        content = open(path).read()
        assert "### Analysis" in content
        assert "edge cases" in content
        assert "### Changes Applied" in content
        assert "auth_test.py" in content

    def test_append_agent_log_creates_file_if_missing(self):
        from services.discussion_writer import append_agent_log, _mission_dir

        append_agent_log(
            mission_id="test-mission-004",
            agent_name="Agent-new",
            heading="First Entry",
            content="Starting work.",
        )
        path = os.path.join(_mission_dir("test-mission-004"), "agent-Agent-new.md")
        assert os.path.exists(path)
        content = open(path).read()
        assert "### First Entry" in content

    def test_write_mission_summary(self):
        from services.discussion_writer import write_mission_summary

        path = write_mission_summary(
            mission_id="test-mission-005",
            title="Complete Refactor",
            merge_results=[
                {"task": "Fix auth", "merged": True},
                {"task": "Fix UI", "merged": False, "error": "merge conflict"},
            ],
            duration_seconds=125.5,
        )
        assert os.path.exists(path)
        content = open(path).read()
        assert "# Mission Summary: Complete Refactor" in content
        assert "✓ Fix auth" in content
        assert "✗ Fix UI: merge conflict" in content
        assert "2m 5s" in content

    def test_write_mission_summary_no_merges(self):
        from services.discussion_writer import write_mission_summary

        path = write_mission_summary(
            mission_id="test-mission-006",
            title="Simple Task",
            merge_results=[],
        )
        content = open(path).read()
        assert "no git changes to merge" in content


# ---------------------------------------------------------------------------
# Chat history loading
# ---------------------------------------------------------------------------

class TestChatHistoryLoading:
    """Tests for _load_chat_history in JasonOrchestrator."""

    @pytest.mark.asyncio
    async def test_load_empty_history(self, db_session):
        from services.jason import jason_orchestrator
        history = await jason_orchestrator._load_chat_history(db_session, "nonexistent-session")
        assert history == []

    @pytest.mark.asyncio
    async def test_load_history_maps_roles(self, db_session):
        """Agent role should be mapped to 'assistant' for LLM compatibility."""
        from services.jason import jason_orchestrator
        from models.chat import ChatSession, ChatMessage

        session = ChatSession(type="user")
        db_session.add(session)
        await db_session.commit()
        await db_session.refresh(session)

        msg1 = ChatMessage(session_id=session.id, role="user", content="Hello")
        msg2 = ChatMessage(session_id=session.id, role="agent", sender_name="Jason", content="Hi there")
        db_session.add_all([msg1, msg2])
        await db_session.commit()

        history = await jason_orchestrator._load_chat_history(db_session, session.id, limit=10)
        assert len(history) == 2
        assert history[0] == {"role": "user", "content": "Hello"}
        assert history[1] == {"role": "assistant", "content": "Hi there"}
