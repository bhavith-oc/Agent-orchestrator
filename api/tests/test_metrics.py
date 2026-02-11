"""Tests for metrics endpoint and service."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_get_metrics(client: AsyncClient):
    """GET /api/metrics returns system and agent metrics."""
    resp = await client.get("/api/metrics")
    assert resp.status_code == 200
    data = resp.json()
    assert "cpu_percent" in data
    assert "memory_used_mb" in data
    assert "memory_total_mb" in data
    assert "memory_percent" in data
    assert "disk_used_mb" in data
    assert "disk_total_mb" in data
    assert "active_agents" in data
    assert "total_agents" in data
    assert isinstance(data["cpu_percent"], (int, float))
    assert isinstance(data["memory_percent"], (int, float))


@pytest.mark.asyncio
async def test_metrics_agent_counts(client: AsyncClient):
    """Metrics should reflect the seeded Jason agent."""
    resp = await client.get("/api/metrics")
    data = resp.json()
    assert data["total_agents"] >= 1
    assert data["active_agents"] >= 1


@pytest.mark.asyncio
async def test_metrics_values_reasonable(client: AsyncClient):
    """Sanity check that metric values are within reasonable ranges."""
    resp = await client.get("/api/metrics")
    data = resp.json()
    assert 0 <= data["cpu_percent"] <= 100
    assert 0 <= data["memory_percent"] <= 100
    assert data["memory_total_mb"] > 0
    assert data["disk_total_mb"] > 0
