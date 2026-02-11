import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, Text, Float
from sqlalchemy.orm import Mapped, mapped_column
from database import Base


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex[:8])
    name: Mapped[str] = mapped_column(String, nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)  # 'master', 'sub'
    status: Mapped[str] = mapped_column(String, default="idle")  # 'idle', 'active', 'busy', 'completed', 'failed', 'offline'
    parent_agent_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    model: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    system_prompt: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    config: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON blob
    worktree_path: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    git_branch: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    current_task: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    load: Mapped[Optional[float]] = mapped_column(Float, default=0.0)
    retry_count: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    terminated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
