import json
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db, async_session
from models.chat import ChatSession, ChatMessage
from models.agent import Agent
from schemas.chat import (
    ChatSessionCreate,
    ChatSessionResponse,
    ChatMessageCreate,
    ChatMessageResponse,
    LegacyMessage,
)
from services.jason import jason_orchestrator
from websocket.manager import ws_manager
from config import settings

router = APIRouter(prefix="/api/chat", tags=["chat"])


# --- Status check ---

@router.get("/status")
async def get_chat_status():
    """Check if the local Jason orchestrator is properly configured."""
    api_key = settings.OPENROUTER_API_KEY
    key_valid = bool(api_key) and api_key != "your-openrouter-api-key-here"
    repo_configured = bool(settings.REPO_PATH)

    issues = []
    if not key_valid:
        issues.append("OpenRouter API key not configured. Set OPENROUTER_API_KEY in api/.env")
    if not repo_configured:
        issues.append("No repository path configured. Running in conversational mode only.")

    return {
        "ready": key_valid,
        "mode": "orchestrator" if repo_configured else "conversational",
        "api_key_configured": key_valid,
        "repo_configured": repo_configured,
        "model": settings.JASON_MODEL,
        "issues": issues,
    }


# --- Session endpoints ---

@router.get("/sessions", response_model=list[ChatSessionResponse])
async def list_sessions(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ChatSession).where(ChatSession.type == "user").order_by(ChatSession.created_at.desc())
    )
    sessions = result.scalars().all()
    return [ChatSessionResponse.model_validate(s) for s in sessions]


@router.post("/sessions", response_model=ChatSessionResponse)
async def create_session(req: ChatSessionCreate, db: AsyncSession = Depends(get_db)):
    # Ensure Jason exists
    jason = await jason_orchestrator.ensure_jason_exists(db)

    session = ChatSession(
        type=req.type,
        agent_id=jason.id,
        mission_id=req.mission_id,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return ChatSessionResponse.model_validate(session)


@router.get("/sessions/{session_id}/messages", response_model=list[ChatMessageResponse])
async def get_session_messages(session_id: str, db: AsyncSession = Depends(get_db)):
    session = await db.get(ChatSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.asc())
    )
    messages = result.scalars().all()

    responses = []
    for msg in messages:
        files = None
        if msg.files:
            try:
                files = json.loads(msg.files)
            except json.JSONDecodeError:
                files = None

        responses.append(ChatMessageResponse(
            id=msg.id,
            session_id=msg.session_id,
            role=msg.role,
            sender_name=msg.sender_name,
            content=msg.content,
            files=files,
            created_at=msg.created_at,
        ))

    return responses


@router.post("/sessions/{session_id}/send", response_model=ChatMessageResponse)
async def send_message(session_id: str, req: ChatMessageCreate, db: AsyncSession = Depends(get_db)):
    session = await db.get(ChatSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Save user message
    user_msg = ChatMessage(
        session_id=session_id,
        role="user",
        content=req.content,
        files=json.dumps(req.files) if req.files else None,
    )
    db.add(user_msg)
    await db.commit()
    await db.refresh(user_msg)

    # Broadcast user message via WebSocket
    await ws_manager.send_to_session(session_id, "chat:message", {
        "id": user_msg.id,
        "role": "user",
        "content": user_msg.content,
    })

    # Send to Jason for processing
    jason_response = await jason_orchestrator.handle_user_message(db, session_id, req.content)

    # Save Jason's response
    agent_msg = ChatMessage(
        session_id=session_id,
        role="agent",
        sender_name="Jason",
        content=jason_response,
    )
    db.add(agent_msg)
    await db.commit()
    await db.refresh(agent_msg)

    # Broadcast Jason's response via WebSocket
    await ws_manager.send_to_session(session_id, "chat:message", {
        "id": agent_msg.id,
        "role": "agent",
        "sender_name": "Jason",
        "content": agent_msg.content,
    })

    return ChatMessageResponse(
        id=agent_msg.id,
        session_id=agent_msg.session_id,
        role=agent_msg.role,
        sender_name=agent_msg.sender_name,
        content=agent_msg.content,
        files=None,
        created_at=agent_msg.created_at,
    )


# --- Legacy endpoints for backward compatibility with existing UI ---

@router.get("/history", response_model=list[LegacyMessage])
async def get_chat_history(db: AsyncSession = Depends(get_db)):
    """Legacy endpoint: returns all messages from the most recent user session."""
    # Find or create default session
    result = await db.execute(
        select(ChatSession)
        .where(ChatSession.type == "user")
        .order_by(ChatSession.created_at.desc())
    )
    session = result.scalars().first()

    if not session:
        # Create a default session
        jason = await jason_orchestrator.ensure_jason_exists(db)
        session = ChatSession(type="user", agent_id=jason.id)
        db.add(session)
        await db.commit()
        await db.refresh(session)

    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session.id)
        .order_by(ChatMessage.created_at.asc())
    )
    messages = result.scalars().all()

    return [
        LegacyMessage(
            role=msg.role,
            name=msg.sender_name,
            content=msg.content,
            files=json.loads(msg.files) if msg.files else None,
        )
        for msg in messages
    ]


@router.post("/send", response_model=LegacyMessage)
async def legacy_send_message(msg: LegacyMessage, db: AsyncSession = Depends(get_db)):
    """Legacy endpoint: send a message to the default session."""
    # Find or create default session
    result = await db.execute(
        select(ChatSession)
        .where(ChatSession.type == "user")
        .order_by(ChatSession.created_at.desc())
    )
    session = result.scalars().first()

    if not session:
        jason = await jason_orchestrator.ensure_jason_exists(db)
        session = ChatSession(type="user", agent_id=jason.id)
        db.add(session)
        await db.commit()
        await db.refresh(session)

    # Save user message
    user_msg = ChatMessage(
        session_id=session.id,
        role=msg.role,
        sender_name=msg.name,
        content=msg.content,
        files=json.dumps(msg.files) if msg.files else None,
    )
    db.add(user_msg)
    await db.commit()

    # If it's a user message, process through Jason
    if msg.role == "user":
        jason_response = await jason_orchestrator.handle_user_message(
            db, session.id, msg.content
        )

        agent_msg = ChatMessage(
            session_id=session.id,
            role="agent",
            sender_name="Jason",
            content=jason_response,
        )
        db.add(agent_msg)
        await db.commit()

        return LegacyMessage(
            role="agent",
            name="Jason",
            content=jason_response,
        )

    return msg


# --- WebSocket endpoint ---

@router.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await ws_manager.connect(websocket, f"chat:{session_id}")
    try:
        while True:
            data = await websocket.receive_text()
            # Client can send messages via WebSocket too
            msg_data = json.loads(data)
            if msg_data.get("type") == "message":
                async with async_session() as db:
                    user_msg = ChatMessage(
                        session_id=session_id,
                        role="user",
                        content=msg_data.get("content", ""),
                    )
                    db.add(user_msg)
                    await db.commit()

                    jason_response = await jason_orchestrator.handle_user_message(
                        db, session_id, msg_data.get("content", "")
                    )

                    agent_msg = ChatMessage(
                        session_id=session_id,
                        role="agent",
                        sender_name="Jason",
                        content=jason_response,
                    )
                    db.add(agent_msg)
                    await db.commit()

    except WebSocketDisconnect:
        ws_manager.disconnect(websocket, f"chat:{session_id}")
