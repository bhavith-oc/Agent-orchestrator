import logging
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from jose import jwt, JWTError
import bcrypt
from fastapi.security import OAuth2PasswordBearer
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests
import httpx

from config import settings
from database import get_db
from models.user import User
from schemas.auth import LoginRequest, GoogleAuthRequest, RegisterRequest, TokenResponse, UserResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    # Block username/password login when Google auth is required
    if settings.AUTH_REQUIRE_GOOGLE:
        raise HTTPException(status_code=403, detail="Username/password login is disabled. Please use Google Sign-In.")

    result = await db.execute(select(User).where(User.username == req.username))
    user = result.scalar_one_or_none()

    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token({"sub": user.id})
    return TokenResponse(
        access_token=token,
        user=UserResponse.model_validate(user),
    )


@router.post("/register", response_model=UserResponse)
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    # Check if username exists
    result = await db.execute(select(User).where(User.username == req.username))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Username already exists")

    user = User(
        username=req.username,
        password_hash=hash_password(req.password),
        role=req.role,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return UserResponse.model_validate(user)


@router.post("/google", response_model=TokenResponse)
async def google_auth(req: GoogleAuthRequest, db: AsyncSession = Depends(get_db)):
    """Authenticate via Google OAuth.

    Accepts either:
    - An access_token (from useGoogleLogin implicit flow) — verified via Google userinfo API
    - An id_token (from Google One Tap / credential flow) — verified via google.oauth2.id_token

    Creates a user if needed, and returns a JWT.
    """
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Google OAuth not configured. Set GOOGLE_CLIENT_ID.")

    credential = req.credential
    google_sub = None
    email = None
    name = None
    avatar = ""

    # Try as id_token first (from One Tap / credential flow)
    try:
        idinfo = google_id_token.verify_oauth2_token(
            credential,
            google_requests.Request(),
            settings.GOOGLE_CLIENT_ID,
        )
        google_sub = idinfo.get("sub")
        email = idinfo.get("email")
        name = idinfo.get("name", "")
        avatar = idinfo.get("picture", "")
    except (ValueError, Exception):
        # Not an id_token — try as access_token via Google userinfo API
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    "https://www.googleapis.com/oauth2/v3/userinfo",
                    headers={"Authorization": f"Bearer {credential}"},
                    timeout=10,
                )
                if resp.status_code != 200:
                    logger.warning(f"Google userinfo failed: {resp.status_code} {resp.text}")
                    raise HTTPException(status_code=401, detail="Invalid Google credential")
                userinfo = resp.json()
                google_sub = userinfo.get("sub")
                email = userinfo.get("email")
                name = userinfo.get("name", "")
                avatar = userinfo.get("picture", "")
        except httpx.HTTPError as e:
            logger.warning(f"Google userinfo request failed: {e}")
            raise HTTPException(status_code=401, detail="Failed to verify Google credential")

    if not name:
        name = email.split("@")[0] if email else "user"

    if not google_sub or not email:
        raise HTTPException(status_code=401, detail="Incomplete Google profile")

    # Enforce email allowlist if configured
    allowed_raw = settings.GOOGLE_ALLOWED_EMAILS
    if allowed_raw:
        allowed_emails = [e.strip().lower() for e in allowed_raw.split(",") if e.strip()]
        if allowed_emails and email.lower() not in allowed_emails:
            logger.warning(f"Google auth denied for {email} — not in allowlist")
            raise HTTPException(status_code=403, detail=f"Access denied. Email {email} is not authorized.")

    # Find existing user by google_id or email
    result = await db.execute(select(User).where(User.google_id == google_sub))
    user = result.scalar_one_or_none()

    if not user:
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()
        if user:
            # Link existing email user to Google
            user.google_id = google_sub
            user.avatar_url = avatar
        else:
            # Create new user from Google profile
            # Ensure unique username
            base_username = name.replace(" ", "_").lower()
            username = base_username
            counter = 1
            while True:
                check = await db.execute(select(User).where(User.username == username))
                if not check.scalar_one_or_none():
                    break
                username = f"{base_username}_{counter}"
                counter += 1

            user = User(
                username=username,
                email=email,
                google_id=google_sub,
                avatar_url=avatar,
                role="admin",
            )
            db.add(user)

    await db.commit()
    await db.refresh(user)

    token = create_access_token({"sub": user.id})
    logger.info(f"Google auth: user={user.username} email={email}")
    return TokenResponse(
        access_token=token,
        user=UserResponse.model_validate(user),
    )


@router.get("/config")
async def get_auth_config():
    """Return auth configuration flags so the frontend knows which login modes are available."""
    return {
        "google_enabled": bool(settings.GOOGLE_CLIENT_ID),
        "google_required": settings.AUTH_REQUIRE_GOOGLE,
        "legacy_login_enabled": not settings.AUTH_REQUIRE_GOOGLE,
    }


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    return UserResponse.model_validate(current_user)
