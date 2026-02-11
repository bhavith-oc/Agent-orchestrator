from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class AgentCreate(BaseModel):
    name: str
    type: str = "sub"
    model: Optional[str] = None
    system_prompt: Optional[str] = None
    config: Optional[str] = None


class AgentUpdate(BaseModel):
    status: Optional[str] = None
    current_task: Optional[str] = None
    load: Optional[float] = None


class AgentResponse(BaseModel):
    id: str
    name: str
    type: str
    status: str
    parent_agent_id: Optional[str] = None
    model: Optional[str] = None
    worktree_path: Optional[str] = None
    git_branch: Optional[str] = None
    current_task: Optional[str] = None
    load: Optional[float] = 0.0
    created_at: datetime
    terminated_at: Optional[datetime] = None
    children: Optional[List["AgentResponse"]] = None

    model_config = {"from_attributes": True}


class AgentWithChildren(AgentResponse):
    children: List[AgentResponse] = []
