import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from config import settings
from database import init_db
from routers import auth, agents, missions, chat, metrics, remote, deploy, deploy_chat, orchestrate
from services.jason import jason_orchestrator
from services.remote_jason import remote_jason_manager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Initializing Aether Orchestrator...")
    await init_db()
    logger.info("Database initialized.")

    # Ensure Jason master agent exists
    from database import async_session
    async with async_session() as db:
        jason = await jason_orchestrator.ensure_jason_exists(db)
        logger.info(f"Jason master agent ready (id={jason.id})")

        # Seed default admin user if none exists
        from sqlalchemy import select
        from models.user import User
        from routers.auth import hash_password
        result = await db.execute(select(User).where(User.username == "admin"))
        if not result.scalar_one_or_none():
            admin = User(
                username="admin",
                password_hash=hash_password("Oc123"),
                role="admin",
            )
            db.add(admin)
            await db.commit()
            logger.info("Default admin user created (admin / Oc123)")

    # Auto-connect to remote Jason if configured
    remote_url = settings.REMOTE_JASON_URL
    remote_token = settings.REMOTE_JASON_TOKEN
    if remote_url and remote_token:
        try:
            session_key = settings.REMOTE_JASON_SESSION or "agent:main:main"
            hello = await remote_jason_manager.connect(remote_url, remote_token, session_key)
            logger.info(f"Remote Jason connected at {remote_url} (protocol={hello.get('protocol')})")
        except Exception as e:
            logger.warning(f"Failed to auto-connect to remote Jason: {e}")

    logger.info("Aether Orchestrator is live.")
    yield
    # Shutdown
    logger.info("Shutting down Aether Orchestrator...")
    await remote_jason_manager.disconnect()
    from services.deployment_chat import deployment_chat_manager
    await deployment_chat_manager.disconnect()
    from services.orchestrator import orchestrator as orch
    await orch.cleanup_connections()


app = FastAPI(title="Aether Orchestrator API", lifespan=lifespan)

# Configure CORS — set CORS_ORIGINS env var for VPS (comma-separated)
_cors_env = os.getenv("CORS_ORIGINS", "")
origins = [o.strip() for o in _cors_env.split(",") if o.strip()] if _cors_env else [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://localhost:3000",
    "http://localhost:8080",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(auth.router)
app.include_router(agents.router)
app.include_router(missions.router)
app.include_router(chat.router)
app.include_router(metrics.router)
app.include_router(remote.router)
app.include_router(deploy.router)
app.include_router(deploy_chat.router)
app.include_router(orchestrate.router)


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "Aether Orchestrator"}


if __name__ == "__main__":
    uvicorn.run(app, host=settings.HOST, port=settings.PORT)
