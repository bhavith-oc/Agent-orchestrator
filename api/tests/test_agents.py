"""Tests for agent endpoints: list, get, update, terminate."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_list_agents(client: AsyncClient):
    resp = await client.get("/api/agents")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    # Jason should be in the list
    jason = next((a for a in data if a["name"] == "Jason"), None)
    assert jason is not None
    assert jason["type"] == "master"
    assert jason["status"] == "active"


@pytest.mark.asyncio
async def test_get_agent_by_id(client: AsyncClient):
    # First get the list to find Jason's ID
    list_resp = await client.get("/api/agents")
    agents = list_resp.json()
    jason = next(a for a in agents if a["name"] == "Jason")

    resp = await client.get(f"/api/agents/{jason['id']}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Jason"
    assert data["type"] == "master"
    assert "children" in data


@pytest.mark.asyncio
async def test_get_agent_not_found(client: AsyncClient):
    resp = await client.get("/api/agents/nonexistent-id")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Agent not found"


@pytest.mark.asyncio
async def test_update_agent(client: AsyncClient):
    list_resp = await client.get("/api/agents")
    jason = next(a for a in list_resp.json() if a["name"] == "Jason")

    resp = await client.put(f"/api/agents/{jason['id']}", json={
        "current_task": "Running integration tests",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["current_task"] == "Running integration tests"


@pytest.mark.asyncio
async def test_terminate_master_agent_fails(client: AsyncClient):
    list_resp = await client.get("/api/agents")
    jason = next(a for a in list_resp.json() if a["name"] == "Jason")

    resp = await client.delete(f"/api/agents/{jason['id']}")
    assert resp.status_code == 400
    assert "Cannot terminate master agent" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_terminate_nonexistent_agent(client: AsyncClient):
    resp = await client.delete("/api/agents/nonexistent-id")
    assert resp.status_code == 404
