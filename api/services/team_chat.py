"""
Team Chat Service — shared chat session per mission where all agents post updates.

Each parent mission gets a single team ChatSession (type='team').
Jason, sub-agents, and the system post messages here.
All messages are broadcast via WebSocket for real-time UI updates.
"""

import logging
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import async_session
from models.chat import ChatSession, ChatMessage
from websocket.manager import ws_manager

logger = logging.getLogger(__name__)


class TeamChatService:
    """Manages team chat sessions tied to missions."""

    async def get_or_create_session(
        self, db: AsyncSession, mission_id: str
    ) -> ChatSession:
        """Get existing team chat session for a mission, or create one."""
        result = await db.execute(
            select(ChatSession).where(
                ChatSession.mission_id == mission_id,
                ChatSession.type == "team",
            )
        )
        session = result.scalar_one_or_none()

        if not session:
            session = ChatSession(
                type="team",
                mission_id=mission_id,
            )
            db.add(session)
            await db.commit()
            await db.refresh(session)
            logger.info(f"Created team chat session {session.id} for mission {mission_id}")

        return session

    async def post_message(
        self,
        mission_id: str,
        sender_name: str,
        content: str,
        role: str = "agent",
        db: Optional[AsyncSession] = None,
    ) -> ChatMessage:
        """Post a message to the team chat for a mission.

        If no db session is provided, creates its own.
        Broadcasts the message via WebSocket.
        """
        own_session = db is None
        if own_session:
            db = async_session()

        try:
            session = await self.get_or_create_session(db, mission_id)

            msg = ChatMessage(
                session_id=session.id,
                role=role,
                sender_name=sender_name,
                content=content,
            )
            db.add(msg)
            await db.commit()
            await db.refresh(msg)

            # Broadcast to WebSocket subscribers
            await ws_manager.broadcast(
                f"team-chat:{mission_id}",
                "team-chat:message",
                {
                    "mission_id": mission_id,
                    "message": {
                        "id": msg.id,
                        "session_id": session.id,
                        "role": msg.role,
                        "sender_name": msg.sender_name,
                        "content": msg.content,
                        "created_at": msg.created_at.isoformat(),
                    },
                },
            )

            # Also broadcast to general channel for UI notifications
            await ws_manager.broadcast_all(
                "team-chat:new-message",
                {
                    "mission_id": mission_id,
                    "sender_name": sender_name,
                    "preview": content[:100],
                },
            )

            return msg

        finally:
            if own_session:
                await db.close()

    async def get_messages(
        self, db: AsyncSession, mission_id: str
    ) -> list[dict]:
        """Get all team chat messages for a mission."""
        session = await self.get_or_create_session(db, mission_id)

        result = await db.execute(
            select(ChatMessage)
            .where(ChatMessage.session_id == session.id)
            .order_by(ChatMessage.created_at.asc())
        )
        messages = result.scalars().all()

        return [
            {
                "id": m.id,
                "session_id": m.session_id,
                "role": m.role,
                "sender_name": m.sender_name,
                "content": m.content,
                "created_at": m.created_at.isoformat(),
            }
            for m in messages
        ]

    async def get_sessions(self, db: AsyncSession) -> list[dict]:
        """List all team chat sessions."""
        result = await db.execute(
            select(ChatSession)
            .where(ChatSession.type == "team")
            .order_by(ChatSession.created_at.desc())
        )
        sessions = result.scalars().all()

        return [
            {
                "id": s.id,
                "mission_id": s.mission_id,
                "created_at": s.created_at.isoformat(),
            }
            for s in sessions
        ]


# Singleton
team_chat = TeamChatService()
