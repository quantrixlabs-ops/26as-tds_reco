"""
Auth routes: register, login, refresh, logout, API key management.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.audit import log_event
from core.deps import get_current_user, require_admin
from core.security import (
    create_access_token, create_refresh_token, decode_token,
    hash_password, verify_password, generate_api_key, hash_api_key,
)
from core.settings import settings
from db.base import get_db
from db.models import User, ApiKey

router = APIRouter(prefix="/api/auth", tags=["auth"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    role: str = "PREPARER"   # ADMIN can promote later


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user_id: str
    role: str
    full_name: str


class RefreshRequest(BaseModel):
    refresh_token: str


class UserOut(BaseModel):
    id: str
    email: str
    full_name: str
    role: str
    is_active: bool
    created_at: datetime


class CreateApiKeyRequest(BaseModel):
    label: str


class ApiKeyOut(BaseModel):
    id: str
    label: str
    raw_key: Optional[str] = None  # only shown on creation
    last_used: Optional[datetime]
    created_at: datetime


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/register", response_model=UserOut, status_code=201)
async def register(
    body: RegisterRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),  # Only admins can register users
):
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")

    if body.role not in ("ADMIN", "PREPARER", "REVIEWER"):
        raise HTTPException(status_code=400, detail="Invalid role")

    user = User(
        email=body.email,
        hashed_password=hash_password(body.password),
        full_name=body.full_name,
        role=body.role,
        is_active=True,
        is_verified=True,
    )
    db.add(user)
    await db.flush()

    await log_event(db, "USER_CREATED", f"User {body.email} created with role {body.role}",
                    user_id=current_user.id, metadata={"new_user_email": body.email})

    return UserOut(id=user.id, email=user.email, full_name=user.full_name,
                   role=user.role, is_active=user.is_active, created_at=user.created_at)


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.email == body.email, User.is_active == True))
    user = result.scalar_one_or_none()

    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    user.last_login = datetime.now(timezone.utc)
    await log_event(db, "USER_LOGIN", f"User {user.email} logged in",
                    user_id=user.id, ip_address=request.client.host if request.client else None)

    return TokenResponse(
        access_token=create_access_token(user.id, user.role),
        refresh_token=create_refresh_token(user.id),
        user_id=user.id,
        role=user.role,
        full_name=user.full_name,
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    try:
        payload = decode_token(body.refresh_token)
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user_id = payload["sub"]
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    result = await db.execute(select(User).where(User.id == user_id, User.is_active == True))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return TokenResponse(
        access_token=create_access_token(user.id, user.role),
        refresh_token=create_refresh_token(user.id),
        user_id=user.id,
        role=user.role,
        full_name=user.full_name,
    )


@router.get("/me", response_model=UserOut)
async def get_me(current_user: User = Depends(get_current_user)):
    return UserOut(
        id=current_user.id, email=current_user.email,
        full_name=current_user.full_name, role=current_user.role,
        is_active=current_user.is_active, created_at=current_user.created_at,
    )


@router.get("/users", response_model=List[UserOut])
async def list_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    users = result.scalars().all()
    return [UserOut(id=u.id, email=u.email, full_name=u.full_name,
                    role=u.role, is_active=u.is_active, created_at=u.created_at) for u in users]


# ── API Key Management ────────────────────────────────────────────────────────

@router.post("/api-keys", response_model=ApiKeyOut, status_code=201)
async def create_api_key(
    body: CreateApiKeyRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    raw_key, key_hash = generate_api_key()
    api_key = ApiKey(
        user_id=current_user.id,
        key_hash=key_hash,
        label=body.label,
        is_active=True,
    )
    db.add(api_key)
    await db.flush()

    await log_event(db, "API_KEY_CREATED", f"API key '{body.label}' created",
                    user_id=current_user.id)

    return ApiKeyOut(id=api_key.id, label=api_key.label, raw_key=raw_key,
                     last_used=api_key.last_used, created_at=api_key.created_at)


@router.delete("/api-keys/{key_id}", status_code=204)
async def revoke_api_key(
    key_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(ApiKey).where(ApiKey.id == key_id, ApiKey.user_id == current_user.id))
    api_key = result.scalar_one_or_none()
    if not api_key:
        raise HTTPException(status_code=404, detail="API key not found")
    api_key.is_active = False
    await log_event(db, "API_KEY_REVOKED", f"API key '{api_key.label}' revoked",
                    user_id=current_user.id)


@router.post("/setup-admin", response_model=UserOut, status_code=201)
async def setup_first_admin(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """
    One-time endpoint to create the first admin user.
    Disabled once any user exists.
    """
    result = await db.execute(select(User))
    if result.scalars().first():
        raise HTTPException(status_code=403, detail="Admin already exists. Use /register via admin account.")

    user = User(
        email=body.email,
        hashed_password=hash_password(body.password),
        full_name=body.full_name,
        role="ADMIN",
        is_active=True,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    await log_event(db, "ADMIN_SETUP", f"First admin {body.email} created", user_id=user.id)

    return UserOut(id=user.id, email=user.email, full_name=user.full_name,
                   role=user.role, is_active=user.is_active, created_at=user.created_at)
