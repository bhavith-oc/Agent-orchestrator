from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class MissionCreate(BaseModel):
    title: str
    description: str = ""
    status: str = "Queue"
    priority: str = "General"
    agents: List[str] = []
    parent_mission_id: Optional[str] = None
    files_scope: Optional[List[str]] = None
    source: str = "manual"
    source_message_id: Optional[str] = None


class MissionUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    assigned_agent_id: Optional[str] = None
    files_scope: Optional[List[str]] = None
    review_status: Optional[str] = None


class MissionResponse(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    status: str
    priority: str
    parent_mission_id: Optional[str] = None
    assigned_agent_id: Optional[str] = None
    agents: List[str] = []
    files_scope: Optional[List[str]] = None
    git_branch: Optional[str] = None
    plan_json: Optional[str] = None
    source: str = "manual"
    source_message_id: Optional[str] = None
    review_status: Optional[str] = None
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    subtasks: Optional[List["MissionResponse"]] = None

    model_config = {"from_attributes": True}


class TaskPlan(BaseModel):
    plan_summary: str
    tasks: List["TaskPlanItem"]


class TaskPlanItem(BaseModel):
    id: str
    title: str
    description: str
    files_scope: List[str] = []
    depends_on: List[str] = []
    priority: str = "General"
