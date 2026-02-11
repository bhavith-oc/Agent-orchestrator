"""
Test fixtures for the Aether Orchestrator API test suite.

Sets up:
- Isolated in-memory SQLite database per test session
- Async test client via httpx
- Auth helper to get JWT tokens
- Pre-seeded admin user and Jason agent
"""

import asyncio
import os
import sys
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

# Ensure the api directory is on the path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Override DATABASE_URL before importing anything else
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
os.environ["REMOTE_JASON_URL"] = ""
os.environ["REMOTE_JASON_TOKEN"] = ""

from database import Base, get_db
from main import app
from routers.auth import hash_password
from models.user import User
from models.agent import Agent


# Create test engine and session factory
test_engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
TestSessionLocal = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)


async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
    async with TestSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="session", autouse=True)
async def setup_database():
    """Create all tables and seed test data once per test session."""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Seed admin user and Jason agent
    async with TestSessionLocal() as db:
        admin = User(
            id="test-admin-id",
            username="admin",
            password_hash=hash_password("Oc123"),
            role="admin",
        )
        db.add(admin)

        jason = Agent(
            id="test-jason-id",
            name="Jason",
            type="master",
            status="active",
            model="openai/gpt-4o",
        )
        db.add(jason)
        await db.commit()

    yield

    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    """Async HTTP test client."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture
async def auth_token(client: AsyncClient) -> str:
    """Get a valid JWT token for the seeded admin user."""
    resp = await client.post("/api/auth/login", json={"username": "admin", "password": "Oc123"})
    assert resp.status_code == 200
    return resp.json()["access_token"]


@pytest_asyncio.fixture
async def auth_headers(auth_token: str) -> dict:
    """Authorization headers with Bearer token."""
    return {"Authorization": f"Bearer {auth_token}"}


@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """Direct database session for test setup/assertions."""
    async with TestSessionLocal() as session:
        yield session
