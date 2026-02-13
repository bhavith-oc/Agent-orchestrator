"""
Team Chat Router — REST API for team chat sessions.

Endpoints:
  GET  /api/team-chat/sessions                — List all team chat sessions
  GET  /api/team-chat/{mission_id}/messages   — Get messages for a mission's team chat
  POST /api/team-chat/{mission_id}/send       — Post a message to a mission's team chat
"""

import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from services.team_chat import team_chat

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/team-chat", tags=["team-chat"])


class TeamChatSendRequest(BaseModel):
    content: str
    sender_name: str = "User"


@router.get("/sessions")
async def list_team_chat_sessions(db: AsyncSession = Depends(get_db)):
    """List all team chat sessions."""
    return await team_chat.get_sessions(db)


@router.get("/{mission_id}/messages")
async def get_team_chat_messages(
    mission_id: str, db: AsyncSession = Depends(get_db)
):
    """Get all messages for a mission's team chat."""
    return await team_chat.get_messages(db, mission_id)


@router.post("/{mission_id}/send")
async def send_team_chat_message(
    mission_id: str,
    req: TeamChatSendRequest,
    db: AsyncSession = Depends(get_db),
):
    """Post a message to a mission's team chat."""
    if not req.content.strip():
        raise HTTPException(status_code=400, detail="Message content cannot be empty")

    msg = await team_chat.post_message(
        mission_id=mission_id,
        sender_name=req.sender_name,
        content=req.content,
        role="user",
        db=db,
    )
    return {
        "id": msg.id,
        "session_id": msg.session_id,
        "role": msg.role,
        "sender_name": msg.sender_name,
        "content": msg.content,
        "created_at": msg.created_at.isoformat(),
    }
