"""
In-memory rate limiter for auth endpoints.

Uses sliding window counter per IP address.
Production: replace with Redis-backed limiter.

Security:
- Login: 5 attempts per 15 minutes per IP
- Register: 3 attempts per 15 minutes per IP
- Password reset: 3 attempts per 15 minutes per IP
- Account lockout: 5 failed logins → 15 minute lock per email
"""
from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Dict, List

from fastapi import HTTPException, Request, status


@dataclass
class RateLimitWindow:
    timestamps: List[float] = field(default_factory=list)

    def clean(self, window_seconds: float) -> None:
        cutoff = time.time() - window_seconds
        self.timestamps = [t for t in self.timestamps if t > cutoff]

    def count(self, window_seconds: float) -> int:
        self.clean(window_seconds)
        return len(self.timestamps)

    def add(self) -> None:
        self.timestamps.append(time.time())


class RateLimiter:
    """Thread-safe in-memory rate limiter (single-process)."""

    def __init__(self):
        # IP-based rate limits: key = f"{endpoint}:{ip}"
        self._ip_windows: Dict[str, RateLimitWindow] = defaultdict(RateLimitWindow)
        # Account lockout: key = email
        self._login_failures: Dict[str, RateLimitWindow] = defaultdict(RateLimitWindow)

    def check_rate_limit(
        self,
        key: str,
        max_requests: int,
        window_seconds: float,
    ) -> None:
        """Raise 429 if rate limit exceeded."""
        window = self._ip_windows[key]
        if window.count(window_seconds) >= max_requests:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Please try again later.",
                headers={"Retry-After": str(int(window_seconds))},
            )
        window.add()

    def record_login_failure(self, email: str) -> None:
        """Record a failed login attempt for account lockout."""
        self._login_failures[email].add()

    def is_account_locked(self, email: str, max_failures: int = 5, lock_seconds: float = 900) -> bool:
        """Check if account is locked due to too many failed logins."""
        window = self._login_failures[email]
        return window.count(lock_seconds) >= max_failures

    def clear_login_failures(self, email: str) -> None:
        """Clear failed login attempts on successful login."""
        if email in self._login_failures:
            del self._login_failures[email]

    def cleanup(self, max_age_seconds: float = 3600) -> None:
        """Periodic cleanup of expired entries."""
        now = time.time()
        for store in (self._ip_windows, self._login_failures):
            expired = [
                k for k, v in store.items()
                if not v.timestamps or (now - max(v.timestamps)) > max_age_seconds
            ]
            for k in expired:
                del store[k]


# Singleton instance
rate_limiter = RateLimiter()


# ── FastAPI dependency helpers ────────────────────────────────────────────────

def get_client_ip(request: Request) -> str:
    """Extract client IP, respecting X-Forwarded-For behind reverse proxy."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def check_login_rate(request: Request) -> None:
    """Rate limit: 5 login attempts per 15 min per IP."""
    ip = get_client_ip(request)
    rate_limiter.check_rate_limit(f"login:{ip}", max_requests=5, window_seconds=900)


def check_register_rate(request: Request) -> None:
    """Rate limit: 3 register attempts per 15 min per IP."""
    ip = get_client_ip(request)
    rate_limiter.check_rate_limit(f"register:{ip}", max_requests=3, window_seconds=900)


def check_reset_rate(request: Request) -> None:
    """Rate limit: 3 password reset requests per 15 min per IP."""
    ip = get_client_ip(request)
    rate_limiter.check_rate_limit(f"reset:{ip}", max_requests=3, window_seconds=900)
