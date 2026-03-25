"""
In-memory progress store for reconciliation runs.

Thread-safe singleton dict keyed by run_id.
Designed for single-process dev (uvicorn --workers 1).
For multi-worker prod, swap to Redis pub/sub.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional

_lock = threading.Lock()
_store: Dict[str, "ProgressState"] = {}
_cancelled: set = set()  # run_ids that have been cancelled


@dataclass
class ProgressState:
    run_id: str
    status: str = "QUEUED"                  # QUEUED | PARSING | VALIDATING | PHASE_A | PHASE_B_SINGLE | PHASE_B_COMBO | PHASE_C | PHASE_E | POST_VALIDATE | PERSISTING | EXCEPTIONS | FINALIZING | COMPLETE | FAILED
    stage_label: str = "Queued"
    overall_pct: float = 0.0
    total_26as: int = 0
    total_sap: int = 0
    matched_so_far: int = 0
    match_rate_so_far: float = 0.0
    current_phase_detail: str = ""
    elapsed_seconds: float = 0.0
    eta_seconds: Optional[float] = None
    stages_completed: List[str] = field(default_factory=list)
    started_at: float = 0.0
    updated_at: float = 0.0

    def to_dict(self) -> dict:
        d = asdict(self)
        d["elapsed_seconds"] = round(time.time() - self.started_at, 1) if self.started_at else 0
        # Recalculate ETA based on progress rate
        elapsed = d["elapsed_seconds"]
        if self.overall_pct > 2 and self.status not in ("COMPLETE", "FAILED"):
            rate = elapsed / self.overall_pct  # seconds per percent
            remaining_pct = 100.0 - self.overall_pct
            d["eta_seconds"] = round(rate * remaining_pct, 1)
        else:
            d["eta_seconds"] = None
        if self.total_26as > 0 and self.matched_so_far > 0:
            d["match_rate_so_far"] = round(self.matched_so_far / self.total_26as * 100, 1)
        return d


# ── Phase weight map for overall % calculation ────────────────────────────────
# Weights must sum to 100.

STAGE_WEIGHTS = {
    "PARSING":        5,
    "VALIDATING":     5,
    "PHASE_A":       10,
    "PHASE_B_SINGLE":25,
    "PHASE_B_COMBO": 15,
    "PHASE_C":       15,
    "PHASE_E":        5,
    "POST_VALIDATE":  2,
    "PERSISTING":     8,
    "EXCEPTIONS":     3,
    "FINALIZING":     7,
}

# Cumulative start offset for each stage
_cumulative: Dict[str, float] = {}
_running = 0.0
for _stage, _weight in STAGE_WEIGHTS.items():
    _cumulative[_stage] = _running
    _running += _weight

STAGE_LABELS = {
    "QUEUED":         "Queued",
    "PARSING":        "Parsing Files",
    "VALIDATING":     "Validating Data",
    "PHASE_A":        "Phase A: Clearing Groups",
    "PHASE_B_SINGLE": "Phase B: Single Matching (Bipartite)",
    "PHASE_B_COMBO":  "Phase B: Combo Matching (ILP)",
    "PHASE_C":        "Phase C: Force Matching",
    "PHASE_E":        "Phase E: Prior-Year Matching",
    "POST_VALIDATE":  "Post-Run Compliance Check",
    "PERSISTING":     "Saving Results to Database",
    "EXCEPTIONS":     "Generating Exceptions",
    "FINALIZING":     "Finalizing Run",
    "COMPLETE":       "Complete",
    "FAILED":         "Failed",
}


def create(run_id: str) -> ProgressState:
    """Initialize progress tracking for a run."""
    state = ProgressState(
        run_id=run_id,
        started_at=time.time(),
        updated_at=time.time(),
    )
    with _lock:
        _store[run_id] = state
    return state


def update(
    run_id: str,
    *,
    status: Optional[str] = None,
    detail: Optional[str] = None,
    phase_pct: Optional[float] = None,
    matched_so_far: Optional[int] = None,
    total_26as: Optional[int] = None,
    total_sap: Optional[int] = None,
) -> Optional[ProgressState]:
    """
    Update progress for a run.

    phase_pct: 0-100 progress within the CURRENT stage.
    overall_pct is computed from stage weight + phase_pct.
    """
    with _lock:
        state = _store.get(run_id)
        if not state:
            return None

        if status and status != state.status:
            # Mark previous stage as completed
            if state.status in STAGE_WEIGHTS:
                if state.status not in state.stages_completed:
                    state.stages_completed.append(state.status)
            state.status = status
            state.stage_label = STAGE_LABELS.get(status, status)

        if detail is not None:
            state.current_phase_detail = detail
        if matched_so_far is not None:
            state.matched_so_far = matched_so_far
        if total_26as is not None:
            state.total_26as = total_26as
        if total_sap is not None:
            state.total_sap = total_sap

        # Compute overall_pct
        if state.status in _cumulative:
            base = _cumulative[state.status]
            weight = STAGE_WEIGHTS[state.status]
            inner = (phase_pct or 0.0) / 100.0
            state.overall_pct = round(base + weight * inner, 1)
        elif state.status == "COMPLETE":
            state.overall_pct = 100.0
        elif state.status == "FAILED":
            pass  # keep last known pct

        state.updated_at = time.time()
        return state


def get(run_id: str) -> Optional[ProgressState]:
    """Read current progress (thread-safe snapshot)."""
    with _lock:
        state = _store.get(run_id)
        if state:
            return state
    return None


def remove(run_id: str) -> None:
    """Clean up after run completes (call after a delay)."""
    with _lock:
        _store.pop(run_id, None)


def mark_complete(run_id: str) -> None:
    update(run_id, status="COMPLETE", detail="Reconciliation finished")


def mark_failed(run_id: str, error: str) -> None:
    update(run_id, status="FAILED", detail=error)


def request_cancel(run_id: str) -> None:
    """Request cancellation of a running reconciliation."""
    with _lock:
        _cancelled.add(run_id)


def is_cancelled(run_id: str) -> bool:
    """Check if a run has been requested for cancellation."""
    with _lock:
        return run_id in _cancelled


def clear_cancel(run_id: str) -> None:
    """Remove cancel flag after run has stopped."""
    with _lock:
        _cancelled.discard(run_id)
