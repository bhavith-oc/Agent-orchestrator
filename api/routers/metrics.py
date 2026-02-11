from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession
import asyncio

from database import get_db
from services.metrics import get_system_metrics
from websocket.manager import ws_manager

router = APIRouter(prefix="/api/metrics", tags=["metrics"])


@router.get("")
async def get_metrics(db: AsyncSession = Depends(get_db)):
    return await get_system_metrics(db)


@router.websocket("/ws")
async def metrics_ws(websocket: WebSocket):
    await ws_manager.connect(websocket, "metrics")
    try:
        while True:
            # We don't have a db session in websocket context easily,
            # so we just send system-level metrics
            import psutil
            cpu = psutil.cpu_percent(interval=0.1)
            mem = psutil.virtual_memory()
            await websocket.send_json({
                "event": "metrics:update",
                "data": {
                    "cpu_percent": round(cpu, 1),
                    "memory_percent": round(mem.percent, 1),
                    "memory_used_mb": round(mem.used / (1024 * 1024), 1),
                },
            })
            await asyncio.sleep(3)
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket, "metrics")
