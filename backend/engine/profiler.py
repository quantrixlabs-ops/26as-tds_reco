"""
Dataset Profiler — analyses input size and selects the optimal matching strategy
before any expensive computation starts.

Strategy tiers:
  STANDARD           — current bipartite (n_a × n_b < MATRIX_CELL_LIMIT)
  CHUNKED            — bipartite in 2,000-entry windows (large single party)
  SECTION_PARTITIONED — run Phase B per section group, merge results (multi-section + large)

The profiler runs in < 500ms on any dataset size.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Dict, List

from config import BIPARTITE_CHUNK_SIZE, MATRIX_CELL_LIMIT

if TYPE_CHECKING:
    from engine.optimizer import As26Entry, BookEntry

logger = logging.getLogger(__name__)

STRATEGY_STANDARD = "STANDARD"
STRATEGY_CHUNKED = "CHUNKED"
STRATEGY_SECTION_PARTITIONED = "SECTION_PARTITIONED"


@dataclass
class DatasetProfile:
    n_26as: int
    n_books: int
    section_mix: Dict[str, float]          # section -> fraction of 26AS entries
    dominant_sections: List[str]           # sections covering > 10% of entries
    estimated_candidates_per_entry: float  # sampled estimate
    estimated_matrix_cells: int            # n_26as × estimated_unique_books
    strategy: str                          # STANDARD | CHUNKED | SECTION_PARTITIONED
    chunk_size: int = BIPARTITE_CHUNK_SIZE # effective chunk size when CHUNKED
    notes: List[str] = field(default_factory=list)


def profile_dataset(
    as26_entries: "List[As26Entry]",
    book_pool: "List[BookEntry]",
) -> DatasetProfile:
    """
    Analyse the dataset and return a DatasetProfile with the recommended strategy.
    Call this BEFORE run_global_optimizer.
    """
    n_26as = len(as26_entries)
    n_books = len(book_pool)

    # Section distribution
    section_counts: Dict[str, int] = {}
    for e in as26_entries:
        sec = e.section or "UNKNOWN"
        section_counts[sec] = section_counts.get(sec, 0) + 1
    section_mix = {
        sec: count / n_26as for sec, count in section_counts.items()
    } if n_26as > 0 else {}
    dominant_sections = [sec for sec, frac in section_mix.items() if frac >= 0.10]

    # Estimate candidates per entry via sampling (max 100 entries)
    sample_size = min(100, n_26as)
    step = max(1, n_26as // sample_size)
    sampled = as26_entries[::step][:sample_size]

    candidate_counts = []
    for e in sampled:
        if e.amount <= 0:
            continue
        low = e.amount * 0.80  # 20% variance ceiling (suggested ceiling)
        high = e.amount * 1.005
        count = sum(1 for b in book_pool if low <= b.amount <= high)
        candidate_counts.append(count)

    avg_candidates = (
        sum(candidate_counts) / len(candidate_counts) if candidate_counts else 10.0
    )
    est_unique_books = min(n_books, int(n_26as * avg_candidates))
    est_matrix_cells = n_26as * est_unique_books

    # Strategy selection
    notes: List[str] = []
    n_dominant_sections = len(dominant_sections)

    if est_matrix_cells <= MATRIX_CELL_LIMIT:
        strategy = STRATEGY_STANDARD
        notes.append(f"Matrix est {est_matrix_cells:,} cells — within {MATRIX_CELL_LIMIT:,} limit")
    elif n_dominant_sections >= 3 and n_26as > BIPARTITE_CHUNK_SIZE:
        strategy = STRATEGY_SECTION_PARTITIONED
        notes.append(
            f"{n_dominant_sections} dominant sections — section-partitioned reduces per-partition size"
        )
    else:
        strategy = STRATEGY_CHUNKED
        notes.append(
            f"Matrix est {est_matrix_cells:,} cells — chunked bipartite "
            f"({BIPARTITE_CHUNK_SIZE} entries/chunk)"
        )

    profile = DatasetProfile(
        n_26as=n_26as,
        n_books=n_books,
        section_mix=section_mix,
        dominant_sections=dominant_sections,
        estimated_candidates_per_entry=round(avg_candidates, 1),
        estimated_matrix_cells=est_matrix_cells,
        strategy=strategy,
        chunk_size=BIPARTITE_CHUNK_SIZE,
        notes=notes,
    )

    logger.info(
        "dataset_profile",
        n_26as=n_26as,
        n_books=n_books,
        strategy=strategy,
        est_matrix_cells=est_matrix_cells,
        sections=list(section_mix.keys()),
    )
    return profile
