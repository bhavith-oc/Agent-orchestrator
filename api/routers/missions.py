import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime

from database import get_db
from models.mission import Mission
from models.agent import Agent
from schemas.mission import MissionCreate, MissionUpdate, MissionResponse

router = APIRouter(prefix="/api/missions", tags=["missions"])


def _mission_to_response(mission: Mission) -> MissionResponse:
    """Convert a Mission ORM object to a MissionResponse schema."""
    agents = []
    if mission.assigned_agent_id:
        agents = [mission.assigned_agent_id]
    files_scope = None
    if mission.files_scope:
        try:
            files_scope = json.loads(mission.files_scope)
        except json.JSONDecodeError:
            files_scope = []

    return MissionResponse(
        id=mission.id,
        title=mission.title,
        description=mission.description,
        status=mission.status,
        priority=mission.priority,
        parent_mission_id=mission.parent_mission_id,
        assigned_agent_id=mission.assigned_agent_id,
        agents=agents,
        files_scope=files_scope,
        git_branch=mission.git_branch,
        plan_json=mission.plan_json,
        created_at=mission.created_at,
        started_at=mission.started_at,
        completed_at=mission.completed_at,
    )


@router.get("", response_model=list[MissionResponse])
async def list_missions(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Mission).order_by(Mission.created_at.desc()))
    missions = result.scalars().all()

    responses = []
    for m in missions:
        resp = _mission_to_response(m)
        # Resolve agent name for the agents list
        if m.assigned_agent_id:
            agent = await db.get(Agent, m.assigned_agent_id)
            if agent:
                resp.agents = [agent.name]
        responses.append(resp)

    return responses


@router.get("/{mission_id}", response_model=MissionResponse)
async def get_mission(mission_id: str, db: AsyncSession = Depends(get_db)):
    mission = await db.get(Mission, mission_id)
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found")

    resp = _mission_to_response(mission)

    # Get subtasks
    result = await db.execute(
        select(Mission).where(Mission.parent_mission_id == mission_id)
    )
    subtasks = result.scalars().all()
    if subtasks:
        resp.subtasks = [_mission_to_response(s) for s in subtasks]

    return resp


@router.post("", response_model=MissionResponse)
async def create_mission(req: MissionCreate, db: AsyncSession = Depends(get_db)):
    mission = Mission(
        title=req.title,
        description=req.description,
        status=req.status,
        priority=req.priority,
        parent_mission_id=req.parent_mission_id,
        files_scope=json.dumps(req.files_scope) if req.files_scope else None,
    )
    db.add(mission)
    await db.commit()
    await db.refresh(mission)

    resp = _mission_to_response(mission)
    # Set agents from request for UI compatibility
    resp.agents = req.agents if req.agents else []
    return resp


@router.put("/{mission_id}", response_model=MissionResponse)
async def update_mission(mission_id: str, req: MissionUpdate, db: AsyncSession = Depends(get_db)):
    mission = await db.get(Mission, mission_id)
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found")

    update_data = req.model_dump(exclude_unset=True)

    if "files_scope" in update_data and update_data["files_scope"] is not None:
        update_data["files_scope"] = json.dumps(update_data["files_scope"])

    for key, value in update_data.items():
        setattr(mission, key, value)

    if req.status == "Active" and not mission.started_at:
        mission.started_at = datetime.utcnow()
    elif req.status == "Completed" and not mission.completed_at:
        mission.completed_at = datetime.utcnow()

    await db.commit()
    await db.refresh(mission)
    return _mission_to_response(mission)


@router.delete("/{mission_id}")
async def delete_mission(mission_id: str, db: AsyncSession = Depends(get_db)):
    mission = await db.get(Mission, mission_id)
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found")

    await db.delete(mission)
    await db.commit()
    return {"status": "success", "message": f"Mission {mission_id} deleted"}
