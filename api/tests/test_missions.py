"""Tests for mission endpoints: list, get, create, update, delete."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_list_missions_empty(client: AsyncClient):
    resp = await client.get("/api/missions")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)


@pytest.mark.asyncio
async def test_create_mission(client: AsyncClient):
    resp = await client.post("/api/missions", json={
        "title": "Test Mission Alpha",
        "description": "Integration test mission",
        "status": "Queue",
        "priority": "General",
        "agents": [],
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "Test Mission Alpha"
    assert data["description"] == "Integration test mission"
    assert data["status"] == "Queue"
    assert data["priority"] == "General"
    assert "id" in data
    assert "created_at" in data


@pytest.mark.asyncio
async def test_create_mission_urgent(client: AsyncClient):
    resp = await client.post("/api/missions", json={
        "title": "Urgent Task",
        "description": "High priority",
        "priority": "Urgent",
    })
    assert resp.status_code == 200
    assert resp.json()["priority"] == "Urgent"


@pytest.mark.asyncio
async def test_get_mission_by_id(client: AsyncClient):
    # Create a mission first
    create_resp = await client.post("/api/missions", json={
        "title": "Fetch Me",
        "description": "To be fetched by ID",
    })
    mission_id = create_resp.json()["id"]

    resp = await client.get(f"/api/missions/{mission_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == mission_id
    assert data["title"] == "Fetch Me"


@pytest.mark.asyncio
async def test_get_mission_not_found(client: AsyncClient):
    resp = await client.get("/api/missions/nonexistent-id")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Mission not found"


@pytest.mark.asyncio
async def test_update_mission_status(client: AsyncClient):
    create_resp = await client.post("/api/missions", json={
        "title": "Status Change",
        "description": "Will be activated",
    })
    mission_id = create_resp.json()["id"]

    # Update to Active
    resp = await client.put(f"/api/missions/{mission_id}", json={"status": "Active"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "Active"
    assert data["started_at"] is not None


@pytest.mark.asyncio
async def test_update_mission_to_completed(client: AsyncClient):
    create_resp = await client.post("/api/missions", json={
        "title": "Complete Me",
    })
    mission_id = create_resp.json()["id"]

    # Activate then complete
    await client.put(f"/api/missions/{mission_id}", json={"status": "Active"})
    resp = await client.put(f"/api/missions/{mission_id}", json={"status": "Completed"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "Completed"
    assert data["completed_at"] is not None


@pytest.mark.asyncio
async def test_update_mission_title_and_description(client: AsyncClient):
    create_resp = await client.post("/api/missions", json={
        "title": "Original Title",
        "description": "Original desc",
    })
    mission_id = create_resp.json()["id"]

    resp = await client.put(f"/api/missions/{mission_id}", json={
        "title": "Updated Title",
        "description": "Updated desc",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "Updated Title"
    assert data["description"] == "Updated desc"


@pytest.mark.asyncio
async def test_update_mission_not_found(client: AsyncClient):
    resp = await client.put("/api/missions/nonexistent-id", json={"title": "X"})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_mission(client: AsyncClient):
    create_resp = await client.post("/api/missions", json={
        "title": "Delete Me",
    })
    mission_id = create_resp.json()["id"]

    resp = await client.delete(f"/api/missions/{mission_id}")
    assert resp.status_code == 200
    assert resp.json()["status"] == "success"

    # Verify it's gone
    get_resp = await client.get(f"/api/missions/{mission_id}")
    assert get_resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_mission_not_found(client: AsyncClient):
    resp = await client.delete("/api/missions/nonexistent-id")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_mission_crud_full_lifecycle(client: AsyncClient):
    """End-to-end: create → list → update → complete → delete."""
    # Create
    create_resp = await client.post("/api/missions", json={
        "title": "Lifecycle Test",
        "description": "Full CRUD test",
        "priority": "Urgent",
    })
    assert create_resp.status_code == 200
    mission_id = create_resp.json()["id"]

    # List — should contain our mission
    list_resp = await client.get("/api/missions")
    titles = [m["title"] for m in list_resp.json()]
    assert "Lifecycle Test" in titles

    # Update to Active
    update_resp = await client.put(f"/api/missions/{mission_id}", json={"status": "Active"})
    assert update_resp.json()["started_at"] is not None

    # Complete
    complete_resp = await client.put(f"/api/missions/{mission_id}", json={"status": "Completed"})
    assert complete_resp.json()["completed_at"] is not None

    # Delete
    delete_resp = await client.delete(f"/api/missions/{mission_id}")
    assert delete_resp.status_code == 200
