"""Tests for authentication endpoints: login, register, me."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_login_success(client: AsyncClient):
    resp = await client.post("/api/auth/login", json={"username": "admin", "password": "Oc123"})
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["user"]["username"] == "admin"
    assert data["user"]["role"] == "admin"
    assert "id" in data["user"]
    assert "created_at" in data["user"]


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient):
    resp = await client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid credentials"


@pytest.mark.asyncio
async def test_login_nonexistent_user(client: AsyncClient):
    resp = await client.post("/api/auth/login", json={"username": "nobody", "password": "pass"})
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid credentials"


@pytest.mark.asyncio
async def test_register_new_user(client: AsyncClient):
    resp = await client.post("/api/auth/register", json={
        "username": "testuser1",
        "password": "testpass123",
        "role": "user",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["username"] == "testuser1"
    assert data["role"] == "user"
    assert "id" in data


@pytest.mark.asyncio
async def test_register_duplicate_username(client: AsyncClient):
    # First registration
    await client.post("/api/auth/register", json={
        "username": "dupuser",
        "password": "pass1",
    })
    # Second registration with same username
    resp = await client.post("/api/auth/register", json={
        "username": "dupuser",
        "password": "pass2",
    })
    assert resp.status_code == 400
    assert "already exists" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_get_me_authenticated(client: AsyncClient, auth_headers: dict):
    resp = await client.get("/api/auth/me", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["username"] == "admin"
    assert data["role"] == "admin"


@pytest.mark.asyncio
async def test_get_me_unauthenticated(client: AsyncClient):
    resp = await client.get("/api/auth/me")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_get_me_invalid_token(client: AsyncClient):
    resp = await client.get("/api/auth/me", headers={"Authorization": "Bearer invalid-token"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_login_then_access_me(client: AsyncClient):
    """End-to-end: login → use token → access /me."""
    login_resp = await client.post("/api/auth/login", json={"username": "admin", "password": "Oc123"})
    token = login_resp.json()["access_token"]

    me_resp = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me_resp.status_code == 200
    assert me_resp.json()["username"] == "admin"
