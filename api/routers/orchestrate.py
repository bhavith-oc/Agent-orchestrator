"""
Orchestration API Router

Endpoints for submitting coding tasks to the Jason master orchestrator,
checking task status, and listing available expert agent types.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from services.orchestrator import orchestrator

router = APIRouter(prefix="/api/orchestrate", tags=["orchestrate"])


# ── Request/Response Models ──────────────────────────────────────

class SubmitTaskRequest(BaseModel):
    description: str
    master_deployment_id: str


class TaskResponse(BaseModel):
    id: str
    description: str
    status: str
    master_deployment_id: str
    subtasks: list[dict]
    plan: Optional[dict] = None
    final_result: Optional[str] = None
    error: Optional[str] = None
    logs: list[str]
    created_at: str
    completed_at: Optional[str] = None


class AgentTemplateResponse(BaseModel):
    type: str
    name: str
    description: str
    tags: list[str]


# ── Endpoints ────────────────────────────────────────────────────

@router.post("/task", response_model=TaskResponse)
async def submit_task(req: SubmitTaskRequest):
    """Submit a coding task for orchestration.

    The orchestrator will:
    1. Ask Jason (master) to decompose the task into subtasks
    2. Execute each subtask using the appropriate expert agent
    3. Synthesize results into a final response

    The task runs asynchronously — poll GET /task/{id} for status.
    """
    if not req.description.strip():
        raise HTTPException(status_code=400, detail="Task description cannot be empty")

    task = await orchestrator.submit_task(
        description=req.description,
        master_deployment_id=req.master_deployment_id,
    )
    return TaskResponse(**task.to_dict())


@router.get("/task/{task_id}", response_model=TaskResponse)
async def get_task(task_id: str):
    """Get the current status of an orchestrated task."""
    task = orchestrator.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return TaskResponse(**task.to_dict())


@router.get("/tasks")
async def list_tasks():
    """List all orchestrated tasks."""
    return orchestrator.list_tasks()


@router.get("/agents", response_model=list[AgentTemplateResponse])
async def list_agent_templates():
    """List available expert agent types that Jason can delegate to."""
    return orchestrator.get_available_agents()
