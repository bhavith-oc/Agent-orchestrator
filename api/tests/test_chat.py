"""Tests for chat endpoints: sessions, messages, legacy history/send."""

import pytest
from httpx import AsyncClient
from unittest.mock import patch, AsyncMock


@pytest.mark.asyncio
async def test_list_sessions_empty(client: AsyncClient):
    resp = await client.get("/api/chat/sessions")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.asyncio
async def test_create_session(client: AsyncClient):
    resp = await client.post("/api/chat/sessions", json={"type": "user"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["type"] == "user"
    assert "id" in data
    assert "created_at" in data


@pytest.mark.asyncio
async def test_get_session_messages_empty(client: AsyncClient):
    # Create a session first
    session_resp = await client.post("/api/chat/sessions", json={"type": "user"})
    session_id = session_resp.json()["id"]

    resp = await client.get(f"/api/chat/sessions/{session_id}/messages")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_get_session_messages_not_found(client: AsyncClient):
    resp = await client.get("/api/chat/sessions/nonexistent-id/messages")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_send_message_to_session(client: AsyncClient):
    """Send a message to a session — mock Jason's LLM response."""
    session_resp = await client.post("/api/chat/sessions", json={"type": "user"})
    session_id = session_resp.json()["id"]

    with patch.object(
        __import__("services.jason", fromlist=["jason_orchestrator"]).jason_orchestrator,
        "handle_user_message",
        new_callable=AsyncMock,
        return_value="I am Jason. How can I help?",
    ):
        resp = await client.post(
            f"/api/chat/sessions/{session_id}/send",
            json={"content": "Hello Jason"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["role"] == "agent"
        assert data["sender_name"] == "Jason"
        assert data["content"] == "I am Jason. How can I help?"

    # Verify messages are persisted
    msgs_resp = await client.get(f"/api/chat/sessions/{session_id}/messages")
    messages = msgs_resp.json()
    assert len(messages) == 2
    assert messages[0]["role"] == "user"
    assert messages[0]["content"] == "Hello Jason"
    assert messages[1]["role"] == "agent"
    assert messages[1]["content"] == "I am Jason. How can I help?"


@pytest.mark.asyncio
async def test_send_message_session_not_found(client: AsyncClient):
    resp = await client.post(
        "/api/chat/sessions/nonexistent-id/send",
        json={"content": "Hello"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_legacy_chat_history(client: AsyncClient):
    """Legacy /chat/history endpoint should return messages."""
    resp = await client.get("/api/chat/history")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.asyncio
async def test_legacy_send_message(client: AsyncClient):
    """Legacy /chat/send endpoint — mock Jason's response."""
    with patch.object(
        __import__("services.jason", fromlist=["jason_orchestrator"]).jason_orchestrator,
        "handle_user_message",
        new_callable=AsyncMock,
        return_value="Acknowledged. Processing your request.",
    ):
        resp = await client.post("/api/chat/send", json={
            "role": "user",
            "content": "Run diagnostics",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["role"] == "agent"
        assert data["name"] == "Jason"
        assert data["content"] == "Acknowledged. Processing your request."


@pytest.mark.asyncio
async def test_legacy_send_non_user_message(client: AsyncClient):
    """Sending a non-user message should echo it back without Jason processing."""
    resp = await client.post("/api/chat/send", json={
        "role": "system",
        "content": "System notification",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["role"] == "system"
    assert data["content"] == "System notification"
