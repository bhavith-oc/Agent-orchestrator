import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex[:8])
    username: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    password_hash: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    role: Mapped[str] = mapped_column(String, default="user")  # 'admin', 'user'
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    email: Mapped[Optional[str]] = mapped_column(String, unique=True, nullable=True)
    google_id: Mapped[Optional[str]] = mapped_column(String, unique=True, nullable=True)
    avatar_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
