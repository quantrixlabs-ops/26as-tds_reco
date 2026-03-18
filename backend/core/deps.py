"""
FastAPI dependencies — auth, DB session, role guards.
"""
from __future__ import annotations

from typing import Optional
from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials, APIKeyHeader
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.security import decode_token, hash_api_key
from db.base import get_db
from db.models import User, ApiKey

bearer_scheme = HTTPBearer(auto_error=False)
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


async def _get_user_from_token(token: str, db: AsyncSession) -> Optional[User]:
    try:
        payload = decode_token(token)
        user_id: str = payload.get("sub")
        if not user_id:
            return None
    except JWTError:
        return None
    result = await db.execute(select(User).where(User.id == user_id, User.is_active == True))
    return result.scalar_one_or_none()


async def _get_user_from_api_key(raw_key: str, db: AsyncSession) -> Optional[User]:
    key_hash = hash_api_key(raw_key)
    result = await db.execute(
        select(ApiKey).where(ApiKey.key_hash == key_hash, ApiKey.is_active == True)
    )
    api_key = result.scalar_one_or_none()
    if not api_key:
        return None
    result2 = await db.execute(select(User).where(User.id == api_key.user_id, User.is_active == True))
    return result2.scalar_one_or_none()


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(bearer_scheme),
    api_key: Optional[str] = Security(api_key_header),
    db: AsyncSession = Depends(get_db),
) -> User:
    user = None
    if credentials:
        user = await _get_user_from_token(credentials.credentials, db)
    if not user and api_key:
        user = await _get_user_from_api_key(api_key, db)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


async def require_preparer(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in ("PREPARER", "REVIEWER", "ADMIN"):
        raise HTTPException(status_code=403, detail="Preparer role required")
    return current_user


async def require_reviewer(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in ("REVIEWER", "ADMIN"):
        raise HTTPException(status_code=403, detail="Reviewer role required")
    return current_user


async def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin role required")
    return current_user
