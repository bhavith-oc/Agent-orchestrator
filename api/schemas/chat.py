from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class ChatSessionCreate(BaseModel):
    type: str = "user"  # 'user' or 'agent'
    agent_id: Optional[str] = None
    mission_id: Optional[str] = None


class ChatSessionResponse(BaseModel):
    id: str
    type: str
    agent_id: Optional[str] = None
    mission_id: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatMessageCreate(BaseModel):
    content: str
    files: Optional[List[dict]] = None


class ChatMessageResponse(BaseModel):
    id: str
    session_id: str
    role: str
    sender_name: Optional[str] = None
    content: str
    files: Optional[List[dict]] = None
    created_at: datetime

    model_config = {"from_attributes": True}


# Legacy schema for backward compatibility with existing UI
class LegacyMessage(BaseModel):
    role: str
    name: Optional[str] = None
    content: str
    files: Optional[List[dict]] = None
