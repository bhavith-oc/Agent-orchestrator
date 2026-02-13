"""
Telegram Bridge Router — API to start/stop the Telegram bridge listener.

Endpoints:
  POST /api/telegram-bridge/start   — Start listening to a master container for Telegram messages
  POST /api/telegram-bridge/stop    — Stop listening
  GET  /api/telegram-bridge/status  — Get bridge status
"""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.telegram_bridge import telegram_bridge

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/telegram-bridge", tags=["telegram-bridge"])


class TelegramBridgeStartRequest(BaseModel):
    deployment_id: str


@router.post("/start")
async def start_telegram_bridge(req: TelegramBridgeStartRequest):
    """Start the Telegram bridge on a deployed master container."""
    try:
        result = await telegram_bridge.start(req.deployment_id)
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.error(f"Telegram bridge start failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/stop")
async def stop_telegram_bridge():
    """Stop the Telegram bridge."""
    await telegram_bridge.stop()
    return {"status": "stopped"}


@router.get("/status")
async def get_telegram_bridge_status():
    """Get the current status of the Telegram bridge."""
    return {
        "running": telegram_bridge.is_running,
        "deployment_id": telegram_bridge._deployment_id,
    }
