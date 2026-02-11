from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime

from database import get_db
from models.agent import Agent
from schemas.agent import AgentCreate, AgentUpdate, AgentResponse, AgentWithChildren

router = APIRouter(prefix="/api/agents", tags=["agents"])


@router.get("", response_model=list[AgentResponse])
async def list_agents(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Agent).order_by(Agent.created_at.desc()))
    agents = result.scalars().all()
    return [AgentResponse.model_validate(a) for a in agents]


@router.get("/{agent_id}", response_model=AgentWithChildren)
async def get_agent(agent_id: str, db: AsyncSession = Depends(get_db)):
    agent = await db.get(Agent, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Get children
    result = await db.execute(
        select(Agent).where(Agent.parent_agent_id == agent_id)
    )
    children = result.scalars().all()

    agent_data = AgentWithChildren.model_validate(agent)
    agent_data.children = [AgentResponse.model_validate(c) for c in children]
    return agent_data


@router.put("/{agent_id}", response_model=AgentResponse)
async def update_agent(agent_id: str, update: AgentUpdate, db: AsyncSession = Depends(get_db)):
    agent = await db.get(Agent, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    update_data = update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(agent, key, value)

    await db.commit()
    await db.refresh(agent)
    return AgentResponse.model_validate(agent)


@router.delete("/{agent_id}")
async def terminate_agent(agent_id: str, db: AsyncSession = Depends(get_db)):
    agent = await db.get(Agent, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    if agent.type == "master":
        raise HTTPException(status_code=400, detail="Cannot terminate master agent")

    agent.status = "offline"
    agent.terminated_at = datetime.utcnow()
    await db.commit()

    return {"status": "success", "message": f"Agent {agent.name} terminated"}
