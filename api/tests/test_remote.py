"""Tests for remote Jason (OpenClaw) endpoints."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_remote_status_disconnected(client: AsyncClient):
    """When no remote is configured, status should show disconnected."""
    resp = await client.get("/api/remote/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["connected"] == False


@pytest.mark.asyncio
async def test_remote_history_not_connected(client: AsyncClient):
    resp = await client.get("/api/remote/history")
    assert resp.status_code == 503
    assert "Not connected" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_remote_send_not_connected(client: AsyncClient):
    resp = await client.post("/api/remote/send", json={"content": "hello"})
    assert resp.status_code == 503


@pytest.mark.asyncio
async def test_remote_sessions_not_connected(client: AsyncClient):
    resp = await client.get("/api/remote/sessions")
    assert resp.status_code == 503


@pytest.mark.asyncio
async def test_remote_agents_not_connected(client: AsyncClient):
    resp = await client.get("/api/remote/agents")
    assert resp.status_code == 503


@pytest.mark.asyncio
async def test_remote_models_not_connected(client: AsyncClient):
    resp = await client.get("/api/remote/models")
    assert resp.status_code == 503


@pytest.mark.asyncio
async def test_remote_disconnect_when_not_connected(client: AsyncClient):
    resp = await client.post("/api/remote/disconnect")
    assert resp.status_code == 200
    assert resp.json()["ok"] == True


@pytest.mark.asyncio
async def test_remote_connect_invalid_url(client: AsyncClient):
    """Connecting to an invalid URL should return 502."""
    resp = await client.post("/api/remote/connect", json={
        "url": "ws://127.0.0.1:1",
        "token": "fake-token",
    })
    assert resp.status_code == 502


# --- Config endpoints ---

@pytest.mark.asyncio
async def test_remote_config_not_connected(client: AsyncClient):
    """GET /api/remote/config should return 503 when not connected."""
    resp = await client.get("/api/remote/config")
    assert resp.status_code == 503
    assert "Not connected" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_remote_config_set_not_connected(client: AsyncClient):
    """PUT /api/remote/config should return 503 when not connected."""
    resp = await client.put("/api/remote/config", json={
        "config": {"agents": {"defaults": {"maxConcurrent": 2}}},
        "hash": "fakehash",
    })
    assert resp.status_code == 503


# --- Agent files endpoints ---

@pytest.mark.asyncio
async def test_remote_agent_files_list_not_connected(client: AsyncClient):
    """GET /api/remote/agent-files should return 503 when not connected."""
    resp = await client.get("/api/remote/agent-files")
    assert resp.status_code == 503


@pytest.mark.asyncio
async def test_remote_agent_file_get_not_connected(client: AsyncClient):
    """GET /api/remote/agent-files/{name} should return 503 when not connected."""
    resp = await client.get("/api/remote/agent-files/IDENTITY.md")
    assert resp.status_code == 503


@pytest.mark.asyncio
async def test_remote_agent_file_set_not_connected(client: AsyncClient):
    """PUT /api/remote/agent-files/{name} should return 503 when not connected."""
    resp = await client.put("/api/remote/agent-files/IDENTITY.md", json={
        "content": "# Test Identity",
    })
    assert resp.status_code == 503


# --- RemoteJasonClient unit tests ---

class TestRemoteJasonClientConfigMethods:
    """Unit tests for the new config/agent-file methods on RemoteJasonClient."""

    def test_client_has_config_methods(self):
        from services.remote_jason import RemoteJasonClient
        client = RemoteJasonClient(url="ws://fake:1234", token="t")
        assert hasattr(client, 'get_config')
        assert hasattr(client, 'set_config')
        assert hasattr(client, 'get_agent_files')
        assert hasattr(client, 'get_agent_file')
        assert hasattr(client, 'set_agent_file')

    @pytest.mark.asyncio
    async def test_get_config_not_connected_raises(self):
        from services.remote_jason import RemoteJasonClient
        client = RemoteJasonClient(url="ws://fake:1234", token="t")
        with pytest.raises(RuntimeError, match="Not connected"):
            await client.get_config()

    @pytest.mark.asyncio
    async def test_get_agent_files_not_connected_raises(self):
        from services.remote_jason import RemoteJasonClient
        client = RemoteJasonClient(url="ws://fake:1234", token="t")
        with pytest.raises(RuntimeError, match="Not connected"):
            await client.get_agent_files()

    @pytest.mark.asyncio
    async def test_set_agent_file_not_connected_raises(self):
        from services.remote_jason import RemoteJasonClient
        client = RemoteJasonClient(url="ws://fake:1234", token="t")
        with pytest.raises(RuntimeError, match="Not connected"):
            await client.set_agent_file("IDENTITY.md", "# Test")
