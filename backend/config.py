"""
Configuration constants for TDS Reconciliation Engine — Phase 1
All tunable parameters live here. Never hardcode these in business logic.
"""
from __future__ import annotations
from datetime import date
from typing import Tuple

# ── Reconciliation Engine ─────────────────────────────────────────────────────
MAX_COMBO_SIZE: int = 8          # Max invoices in a single combination match
COMBO_LIMIT: int = 200           # Max combinations tried per 26AS entry
EXACT_TOLERANCE: float = 0.01   # ₹ difference threshold for EXACT classification

# ── Cleaning Pipeline ─────────────────────────────────────────────────────────
NOISE_THRESHOLD: float = 100.0  # Rows with amount < ₹100 are excluded as noise

# ── Name Alignment ────────────────────────────────────────────────────────────
FUZZY_THRESHOLD: int = 80        # Min rapidfuzz score for a valid candidate
AUTO_CONFIRM_SCORE: int = 95     # Score at/above which alignment auto-confirms
TOP_N_CANDIDATES: int = 5        # How many candidates to surface to user

# ── Session Store ─────────────────────────────────────────────────────────────
SESSION_TTL_SECONDS: int = 1800  # 30 minutes

# ── Financial Years ───────────────────────────────────────────────────────────
# Supported FY labels and their date ranges (April 1 → March 31)
SUPPORTED_FINANCIAL_YEARS: list[str] = [
    "FY2020-21",
    "FY2021-22",
    "FY2022-23",
    "FY2023-24",
    "FY2024-25",
    "FY2025-26",
]

DEFAULT_FINANCIAL_YEAR: str = "FY2023-24"


def fy_date_range(fy_label: str) -> Tuple[date, date]:
    """
    Return (fy_start, fy_end) for a label like 'FY2023-24'.
    FY2023-24  →  01-Apr-2023  to  31-Mar-2024
    """
    # Parse start year from label e.g. "FY2023-24" → 2023
    try:
        start_year = int(fy_label.replace("FY", "").split("-")[0])
    except (ValueError, IndexError):
        raise ValueError(f"Invalid FY label '{fy_label}'. Expected format: FY2023-24")
    return date(start_year, 4, 1), date(start_year + 1, 3, 31)


def fy_label_from_date_range(fy_start: date) -> str:
    """Inverse of fy_date_range — build label from start date."""
    sy = fy_start.year
    return f"FY{sy}-{str(sy + 1)[2:]}"
