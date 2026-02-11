from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class LoginRequest(BaseModel):
    username: str
    password: str


class GoogleAuthRequest(BaseModel):
    credential: str  # Google ID token from frontend


class RegisterRequest(BaseModel):
    username: str
    password: str
    role: str = "user"


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserResponse"


class UserResponse(BaseModel):
    id: str
    username: str
    role: str
    created_at: datetime
    email: Optional[str] = None
    avatar_url: Optional[str] = None

    model_config = {"from_attributes": True}
