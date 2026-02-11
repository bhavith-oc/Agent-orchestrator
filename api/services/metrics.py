import psutil
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from models.agent import Agent


async def get_system_metrics(db: AsyncSession) -> dict:
    """Collect system and agent metrics."""
    # System metrics
    cpu_percent = psutil.cpu_percent(interval=0.1)
    memory = psutil.virtual_memory()
    disk = psutil.disk_usage("/")

    # Agent metrics
    active_result = await db.execute(
        select(func.count(Agent.id)).where(Agent.status.in_(["active", "busy"]))
    )
    active_agents = active_result.scalar() or 0

    total_result = await db.execute(select(func.count(Agent.id)))
    total_agents = total_result.scalar() or 0

    return {
        "cpu_percent": round(cpu_percent, 1),
        "memory_used_mb": round(memory.used / (1024 * 1024), 1),
        "memory_total_mb": round(memory.total / (1024 * 1024), 1),
        "memory_percent": round(memory.percent, 1),
        "disk_used_mb": round(disk.used / (1024 * 1024), 1),
        "disk_total_mb": round(disk.total / (1024 * 1024), 1),
        "active_agents": active_agents,
        "total_agents": total_agents,
        "uptime_seconds": 0,  # Will be set by the app startup time
    }
