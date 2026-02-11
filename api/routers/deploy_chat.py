"""
Deploy Chat Router — Chat with locally deployed OpenClaw containers.

Endpoints:
  POST /api/deploy-chat/connect      — Connect to a deployed container
  POST /api/deploy-chat/disconnect   — Disconnect from current deployment
  GET  /api/deploy-chat/status       — Get connection status + session name
  GET  /api/deploy-chat/history      — Get chat history from connected deployment
  POST /api/deploy-chat/send         — Send a message to connected deployment
"""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.deployment_chat import deployment_chat_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/deploy-chat", tags=["deploy-chat"])


# --- Request Models ---

class DeployChatConnectRequest(BaseModel):
    deployment_id: str
    session_name: Optional[str] = None


class DeployChatSendRequest(BaseModel):
    content: str


# --- Endpoints ---

@router.post("/connect")
async def connect_to_deployment(req: DeployChatConnectRequest):
    """Connect to a deployed container's OpenClaw gateway for chatting."""
    try:
        result = await deployment_chat_manager.connect(
            deployment_id=req.deployment_id,
            session_name=req.session_name,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.error(f"Deploy chat connect failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/disconnect")
async def disconnect_from_deployment():
    """Disconnect from the current deployment chat."""
    await deployment_chat_manager.disconnect()
    return {"ok": True, "message": "Disconnected from deployment"}


@router.get("/status")
async def get_deploy_chat_status():
    """Get the current deployment chat connection status."""
    return await deployment_chat_manager.get_status()


@router.get("/history")
async def get_deploy_chat_history():
    """Get chat history from the connected deployment."""
    try:
        history = await deployment_chat_manager.get_history()
        return history
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Deploy chat history failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/send")
async def send_deploy_chat_message(req: DeployChatSendRequest):
    """Send a message to the connected deployment and get the response."""
    try:
        result = await deployment_chat_manager.send_message(req.content)
        return result
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except TimeoutError as e:
        raise HTTPException(status_code=504, detail=str(e))
    except Exception as e:
        logger.error(f"Deploy chat send failed: {e}")
        raise HTTPException(status_code=502, detail=str(e))
