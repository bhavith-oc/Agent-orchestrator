import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column
from database import Base


class Mission(Base):
    __tablename__ = "missions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex[:8])
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String, default="Queue")  # 'Queue', 'Active', 'Completed', 'Failed'
    priority: Mapped[str] = mapped_column(String, default="General")  # 'General', 'Urgent'
    parent_mission_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    assigned_agent_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    files_scope: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON array
    git_branch: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    plan_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # Task plan (parent missions)
    source: Mapped[str] = mapped_column(String, default="manual")  # 'manual', 'telegram', 'api'
    source_message_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # Telegram msg/chat ID
    review_status: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # 'pending_review', 'approved', 'changes_requested'
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class MissionDependency(Base):
    __tablename__ = "mission_dependencies"

    mission_id: Mapped[str] = mapped_column(String, primary_key=True)
    depends_on_id: Mapped[str] = mapped_column(String, primary_key=True)
