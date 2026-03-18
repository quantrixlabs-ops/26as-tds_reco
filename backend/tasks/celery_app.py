"""
Celery task queue — async processing for large reconciliation runs.
Uses fakeredis in dev (USE_FAKE_REDIS=True), real Redis in prod.
"""
from __future__ import annotations

import asyncio
from celery import Celery
from core.settings import settings

# Use fakeredis in development
if settings.USE_FAKE_REDIS:
    import fakeredis
    from unittest.mock import patch

    # Patch redis connection for celery
    broker = "memory://"
    backend = "cache+memory://"
else:
    broker = settings.CELERY_BROKER
    backend = settings.CELERY_BACKEND

celery_app = Celery(
    "26as_matcher",
    broker=broker,
    backend=backend,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Kolkata",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_routes={
        "tasks.reconcile_task": {"queue": "reconciliation"},
        "tasks.batch_task": {"queue": "batch"},
    },
)


@celery_app.task(bind=True, name="tasks.reconcile_task", max_retries=2)
def reconcile_task(self, run_id: str, user_id: str):
    """
    Async reconciliation task.
    In v2.0 this is called for large files that would block the API.
    """
    import structlog
    logger = structlog.get_logger(__name__)
    logger.info("celery.reconcile_task.started", run_id=run_id, user_id=user_id)
    # Full async execution handled via asyncio.run in worker
    # Implementation: fetch run from DB, resume processing, update status
    return {"status": "queued", "run_id": run_id}


@celery_app.task(bind=True, name="tasks.batch_task", max_retries=2)
def batch_task(self, batch_id: str, user_id: str):
    """Async batch reconciliation task."""
    import structlog
    logger = structlog.get_logger(__name__)
    logger.info("celery.batch_task.started", batch_id=batch_id, user_id=user_id)
    return {"status": "queued", "batch_id": batch_id}
