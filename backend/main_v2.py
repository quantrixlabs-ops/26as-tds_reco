"""
26AS Matcher — Enterprise API v2.0
FastAPI application with full auth, audit, and persistence.
"""
from __future__ import annotations

import structlog
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware

from core.settings import settings
from db.base import create_all_tables, auto_migrate

# Configure structured logging
structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.stdlib.add_log_level,
        structlog.dev.ConsoleRenderer() if settings.DEBUG else structlog.processors.JSONRenderer(),
    ]
)

logger = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle."""
    logger.info("startup", version=settings.APP_VERSION, env=settings.ENVIRONMENT)
    await create_all_tables()
    await auto_migrate()
    logger.info("database_ready")

    # Clean up orphaned PROCESSING runs from previous server crashes/restarts.
    # Background asyncio tasks are killed when uvicorn reloads, leaving DB rows stuck.
    from db.base import AsyncSessionLocal
    from sqlalchemy import text as sql_text
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            sql_text("UPDATE reconciliation_runs SET status='FAILED' WHERE status='PROCESSING'")
        )
        if result.rowcount > 0:
            logger.warning("orphaned_runs_cleaned", count=result.rowcount)

        await session.commit()

    yield
    logger.info("shutdown")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description=(
        "Enterprise TDS Reconciliation Platform — "
        "Audit-compliant, deterministic, reproducible."
    ),
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

# ── Middleware ────────────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────

from api.routes.auth import router as auth_router
from api.routes.runs import router as runs_router
from api.routes.settings import router as settings_router

app.include_router(auth_router)
app.include_router(runs_router)
app.include_router(settings_router)


# ── Health + Meta ─────────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "version": settings.APP_VERSION,
        "algorithm_version": settings.ALGORITHM_VERSION,
        "environment": settings.ENVIRONMENT,
    }


@app.get("/api/financial-years")
async def financial_years():
    from config import SUPPORTED_FINANCIAL_YEARS, DEFAULT_FINANCIAL_YEAR
    return {"years": SUPPORTED_FINANCIAL_YEARS, "default": DEFAULT_FINANCIAL_YEAR}
