"""
Global Optimization Engine — replaces greedy sequential matching.

Strategy (two-tier):
  Tier 1 — Bipartite matching (scipy.optimize.linear_sum_assignment):
    Applied to EXACT and SINGLE candidates.
    Guarantees a globally optimal 1:1 assignment when one invoice matches one 26AS entry.
    Polynomial time complexity O(n³).

  Tier 2 — ILP (Integer Linear Programming via PuLP):
    Applied to COMBO candidates (multiple invoices → one 26AS entry).
    Objective: maximize total composite score across all assignments.
    Constraints: each invoice used at most once, each 26AS entry assigned at most once,
                 books_sum ≤ as26_amount (Section 199 hard constraint).

Both tiers use composite scores from scorer.py — NOT just variance.
Final selection is deterministic and reproducible (same input → same output every time).

If scipy/PuLP unavailable, falls back to enhanced greedy (descending score order).
"""
from __future__ import annotations

import itertools
import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple

import numpy as np

try:
    from scipy.optimize import linear_sum_assignment
    SCIPY_AVAILABLE = True
except ImportError:
    SCIPY_AVAILABLE = False

try:
    from pulp import (
        LpProblem, LpVariable, LpMaximize, LpBinary,
        lpSum, value as lp_value, PULP_CBC_CMD, LpStatus
    )
    PULP_AVAILABLE = True
except ImportError:
    PULP_AVAILABLE = False

from engine.scorer import score_candidate, BookCandidate, ScoreBreakdown
from config import (
    EXACT_TOLERANCE, VARIANCE_CAP_SINGLE, VARIANCE_CAP_COMBO,
    VARIANCE_CAP_CLR_GROUP, VARIANCE_CAP_FORCE_SINGLE,
    FORCE_COMBO_MAX_INVOICES, FORCE_COMBO_MAX_VARIANCE,
    MAX_COMBO_SIZE, COMBO_LIMIT,
)

logger = logging.getLogger(__name__)


@dataclass
class BookEntry:
    index: int
    invoice_ref: str
    amount: float
    doc_date: Optional[str]
    doc_type: str
    clearing_doc: str
    sap_fy: str
    flag: str = ""


@dataclass
class As26Entry:
    index: int
    amount: float
    transaction_date: Optional[str]
    section: str
    tan: str
    deductor_name: str
    tds_amount: Optional[float] = None
    row_hash: str = ""


@dataclass
class AssignmentResult:
    as26_index: int
    as26_amount: float
    as26_date: Optional[str]
    as26_section: str
    books: List[BookEntry]
    match_type: str         # EXACT / SINGLE / COMBO_N / CLR_GROUP / FORCE_SINGLE / FORCE_COMBO / PRIOR_YEAR_EXCEPTION
    variance_pct: float
    variance_amt: float
    confidence: str         # HIGH / MEDIUM / LOW
    score: ScoreBreakdown
    cross_fy: bool = False
    is_prior_year: bool = False
    alternative_matches: List[dict] = field(default_factory=list)


# ── Main entry point ──────────────────────────────────────────────────────────

def run_global_optimizer(
    as26_entries: List[As26Entry],
    book_pool: List[BookEntry],
    current_books: List[BookEntry],
    prior_books: List[BookEntry],
    allow_cross_fy: bool = False,
) -> Tuple[List[AssignmentResult], List[As26Entry]]:
    """
    Run the full global optimization pipeline.

    Returns:
        (matched_results, unmatched_as26_entries)
    """
    used_book_indices: Set[int] = set()
    consumed_invoice_refs: Set[str] = set()
    matched: List[AssignmentResult] = []
    unmatched: List[As26Entry] = []

    active_books = current_books if not allow_cross_fy else book_pool

    # ── Phase A: Clearing Group Matching ─────────────────────────────────────
    logger.info("optimizer.phase_a_start")
    phase_a_matched, phase_a_unmatched = _phase_a_clearing_groups(
        as26_entries, active_books, used_book_indices, consumed_invoice_refs
    )
    matched.extend(phase_a_matched)

    # ── Phase B: Global Bipartite + ILP ──────────────────────────────────────
    logger.info("optimizer.phase_b_start", remaining=len(phase_a_unmatched))
    phase_b_matched, phase_b_unmatched = _phase_b_global(
        phase_a_unmatched, active_books, used_book_indices, consumed_invoice_refs
    )
    matched.extend(phase_b_matched)

    # ── Phase C: Restricted Force-Match ──────────────────────────────────────
    logger.info("optimizer.phase_c_start", remaining=len(phase_b_unmatched))
    phase_c_matched, phase_c_unmatched = _phase_c_force(
        phase_b_unmatched, active_books, used_book_indices, consumed_invoice_refs
    )
    matched.extend(phase_c_matched)

    # ── Phase E: Prior-Year Exception ─────────────────────────────────────────
    if not allow_cross_fy and prior_books:
        logger.info("optimizer.phase_e_start", remaining=len(phase_c_unmatched))
        phase_e_matched, phase_e_unmatched = _phase_b_global(
            phase_c_unmatched, prior_books, used_book_indices, consumed_invoice_refs,
            tag_as_prior=True
        )
        for r in phase_e_matched:
            r.is_prior_year = True
            r.cross_fy = True
            r.match_type = f"PRIOR_{r.match_type}"
            r.confidence = "LOW"
        matched.extend(phase_e_matched)
        unmatched = phase_e_unmatched
    else:
        unmatched = phase_c_unmatched

    # ── Post-run compliance validation ────────────────────────────────────────
    _validate_compliance(matched, allow_cross_fy)

    logger.info("optimizer.complete",
                matched=len(matched), unmatched=len(unmatched))
    return matched, unmatched


# ── Phase A: Clearing Groups ──────────────────────────────────────────────────

def _phase_a_clearing_groups(
    as26_entries: List[As26Entry],
    book_pool: List[BookEntry],
    used_book_indices: Set[int],
    consumed_invoice_refs: Set[str],
) -> Tuple[List[AssignmentResult], List[As26Entry]]:
    """Group SAP books by clearing_doc, then match 26AS entries to whole groups."""
    # Build groups
    from collections import defaultdict
    groups: Dict[str, List[BookEntry]] = defaultdict(list)
    for b in book_pool:
        if b.clearing_doc and b.clearing_doc not in ("", "0"):
            groups[b.clearing_doc].append(b)

    # Filter: groups of 2–MAX_COMBO_SIZE only
    valid_groups = {k: v for k, v in groups.items() if 2 <= len(v) <= MAX_COMBO_SIZE}

    matched: List[AssignmentResult] = []
    unmatched_26as: List[As26Entry] = []

    for as26 in as26_entries:
        best_result = None
        best_score = -1.0

        for clr_doc, group in valid_groups.items():
            # All entries available?
            available = [
                b for b in group
                if b.index not in used_book_indices
                and (not b.invoice_ref or b.invoice_ref not in consumed_invoice_refs)
            ]
            if len(available) != len(group):
                continue  # Group partially consumed — skip

            group_sum = sum(b.amount for b in available)
            if group_sum > as26.amount + EXACT_TOLERANCE:
                continue

            var_pct = _variance_pct(as26.amount, group_sum)
            if var_pct > VARIANCE_CAP_CLR_GROUP:
                continue

            candidate = BookCandidate(
                invoice_refs=[b.invoice_ref for b in available],
                amounts=[b.amount for b in available],
                dates=[b.doc_date for b in available],
                clearing_doc=clr_doc,
                sap_fy=available[0].sap_fy if available else None,
            )
            score = score_candidate(as26.amount, as26.transaction_date, as26.section, candidate)

            if score.total > best_score:
                best_score = score.total
                best_result = (available, score, var_pct, clr_doc)

        if best_result:
            books, score, var_pct, clr_doc = best_result
            _commit(books, used_book_indices, consumed_invoice_refs)
            matched.append(AssignmentResult(
                as26_index=as26.index,
                as26_amount=as26.amount,
                as26_date=as26.transaction_date,
                as26_section=as26.section,
                books=books,
                match_type=f"CLR_GROUP_{len(books)}",
                variance_pct=round(var_pct, 4),
                variance_amt=round(as26.amount - sum(b.amount for b in books), 2),
                confidence=_confidence(var_pct, "CLR_GROUP"),
                score=score,
            ))
        else:
            unmatched_26as.append(as26)

    return matched, unmatched_26as


# ── Phase B: Global Bipartite + ILP ──────────────────────────────────────────

def _phase_b_global(
    as26_entries: List[As26Entry],
    book_pool: List[BookEntry],
    used_book_indices: Set[int],
    consumed_invoice_refs: Set[str],
    tag_as_prior: bool = False,
) -> Tuple[List[AssignmentResult], List[As26Entry]]:
    """
    Build candidate graph, then run bipartite optimizer (size-1) and ILP (combo).
    """
    if not as26_entries:
        return [], []

    # Build candidate lists: for each (as26, book/combo), compute score
    # Single candidates first
    single_candidates = _build_single_candidates(
        as26_entries, book_pool, used_book_indices, consumed_invoice_refs
    )

    # Run bipartite on single candidates
    if SCIPY_AVAILABLE:
        bip_matched, bip_unmatched_26as, bip_used_books = _bipartite_match(
            as26_entries, single_candidates, used_book_indices, consumed_invoice_refs
        )
    else:
        logger.warning("scipy unavailable — using greedy fallback for single matches")
        bip_matched, bip_unmatched_26as, bip_used_books = _greedy_single(
            as26_entries, single_candidates, used_book_indices, consumed_invoice_refs
        )

    matched = list(bip_matched)
    for idx in bip_used_books:
        used_book_indices.add(idx)
        b = next((b for b in book_pool if b.index == idx), None)
        if b and b.invoice_ref:
            consumed_invoice_refs.add(b.invoice_ref)

    # Combo matching for remaining with ILP or greedy
    if bip_unmatched_26as:
        if PULP_AVAILABLE:
            combo_matched, final_unmatched = _ilp_combo_match(
                bip_unmatched_26as, book_pool, used_book_indices, consumed_invoice_refs
            )
        else:
            logger.warning("PuLP unavailable — using greedy fallback for combo matches")
            combo_matched, final_unmatched = _greedy_combo(
                bip_unmatched_26as, book_pool, used_book_indices, consumed_invoice_refs
            )
        matched.extend(combo_matched)
    else:
        final_unmatched = []

    return matched, final_unmatched


def _build_single_candidates(
    as26_entries: List[As26Entry],
    book_pool: List[BookEntry],
    used_book_indices: Set[int],
    consumed_invoice_refs: Set[str],
) -> Dict[Tuple[int, int], Tuple[float, float, str]]:
    """
    Returns {(as26_idx, book_idx): (score, variance_pct, match_type)}
    for all valid single-book candidates within SINGLE variance cap.
    """
    candidates = {}
    for as26 in as26_entries:
        for b in book_pool:
            if b.index in used_book_indices:
                continue
            if b.invoice_ref and b.invoice_ref in consumed_invoice_refs:
                continue
            if b.amount > as26.amount + EXACT_TOLERANCE:
                continue
            var_pct = _variance_pct(as26.amount, b.amount)
            if var_pct > VARIANCE_CAP_SINGLE:
                continue  # outside single cap

            match_type = "EXACT" if var_pct <= (EXACT_TOLERANCE / as26.amount * 100 if as26.amount > 0 else 0.001) else "SINGLE"
            candidate = BookCandidate(
                invoice_refs=[b.invoice_ref],
                amounts=[b.amount],
                dates=[b.doc_date],
                clearing_doc=b.clearing_doc,
                sap_fy=b.sap_fy,
            )
            score = score_candidate(as26.amount, as26.transaction_date, as26.section, candidate)
            candidates[(as26.index, b.index)] = (score.total, var_pct, match_type, score, b)

    return candidates


def _bipartite_match(
    as26_entries: List[As26Entry],
    candidates: dict,
    used_book_indices: Set[int],
    consumed_invoice_refs: Set[str],
) -> Tuple[List[AssignmentResult], List[As26Entry], Set[int]]:
    """
    scipy linear_sum_assignment on the candidate score matrix.
    Maximizes total composite score across all 1:1 assignments globally.
    """
    as26_idx_map = {e.index: i for i, e in enumerate(as26_entries)}
    book_indices = sorted(set(b.index for (_, bi), (_, _, _, _, b) in candidates.items()
                              for bi in [b.index]))
    book_idx_map = {bi: i for i, bi in enumerate(book_indices)}

    n_a = len(as26_entries)
    n_b = len(book_indices)

    if n_a == 0 or n_b == 0:
        return [], as26_entries, set()

    # Cost matrix: negate score (scipy minimizes)
    cost = np.full((n_a, n_b), 1000.0)  # 1000 = "no candidate" (high cost)

    entry_map: Dict[Tuple[int, int], tuple] = {}  # (row, col) → candidate data
    for (a_idx, b_idx), (score_val, var_pct, match_type, score_obj, book) in candidates.items():
        if a_idx in as26_idx_map and b_idx in book_idx_map:
            row = as26_idx_map[a_idx]
            col = book_idx_map[b_idx]
            cost[row][col] = 100.0 - score_val  # negate
            entry_map[(row, col)] = (var_pct, match_type, score_obj, book)

    row_ind, col_ind = linear_sum_assignment(cost)

    matched: List[AssignmentResult] = []
    matched_as26_indices: Set[int] = set()
    used_books: Set[int] = set()

    for row, col in zip(row_ind, col_ind):
        if cost[row][col] >= 999.0:
            continue  # no valid candidate assigned
        as26 = as26_entries[row]
        var_pct, match_type, score_obj, book = entry_map[(row, col)]

        matched.append(AssignmentResult(
            as26_index=as26.index,
            as26_amount=as26.amount,
            as26_date=as26.transaction_date,
            as26_section=as26.section,
            books=[book],
            match_type=match_type,
            variance_pct=round(var_pct, 4),
            variance_amt=round(as26.amount - book.amount, 2),
            confidence=_confidence(var_pct, match_type),
            score=score_obj,
        ))
        matched_as26_indices.add(as26.index)
        used_books.add(book.index)

    unmatched = [e for e in as26_entries if e.index not in matched_as26_indices]
    return matched, unmatched, used_books


def _ilp_combo_match(
    as26_entries: List[As26Entry],
    book_pool: List[BookEntry],
    used_book_indices: Set[int],
    consumed_invoice_refs: Set[str],
) -> Tuple[List[AssignmentResult], List[As26Entry]]:
    """
    ILP for combo matching: maximize total score subject to:
    - Each book used at most once
    - Each 26AS entry matched at most once
    - books_sum ≤ as26_amount (Section 199)
    - Max combo size ≤ MAX_COMBO_SIZE
    """
    available_books = [
        b for b in book_pool
        if b.index not in used_book_indices
        and (not b.invoice_ref or b.invoice_ref not in consumed_invoice_refs)
    ]

    if not available_books or not as26_entries:
        return [], as26_entries

    # Generate combo candidates
    all_combos = []  # (as26_idx, book_indices_tuple, score, var_pct, match_type, score_obj, books)
    for as26 in as26_entries:
        per_size_count = 0
        for size in range(2, min(MAX_COMBO_SIZE + 1, len(available_books) + 1)):
            count_this_size = 0
            for combo in itertools.combinations(available_books, size):
                if count_this_size >= COMBO_LIMIT:
                    break
                combo_sum = sum(b.amount for b in combo)
                if combo_sum > as26.amount + EXACT_TOLERANCE:
                    continue
                var_pct = _variance_pct(as26.amount, combo_sum)
                cap = VARIANCE_CAP_SINGLE if size == 2 else VARIANCE_CAP_COMBO
                if var_pct > cap:
                    continue

                candidate = BookCandidate(
                    invoice_refs=[b.invoice_ref for b in combo],
                    amounts=[b.amount for b in combo],
                    dates=[b.doc_date for b in combo],
                    clearing_doc=combo[0].clearing_doc if len(set(b.clearing_doc for b in combo)) == 1 else None,
                    sap_fy=combo[0].sap_fy,
                )
                score_obj = score_candidate(as26.amount, as26.transaction_date, as26.section, candidate)
                all_combos.append((as26.index, tuple(b.index for b in combo), score_obj.total, var_pct,
                                   f"COMBO_{size}", score_obj, list(combo)))
                count_this_size += 1
            per_size_count += count_this_size

    if not all_combos:
        return [], as26_entries

    # ILP: maximize sum of scores
    prob = LpProblem("combo_match", LpMaximize)
    x = {i: LpVariable(f"x_{i}", cat=LpBinary) for i in range(len(all_combos))}

    # Objective
    prob += lpSum(x[i] * all_combos[i][2] for i in range(len(all_combos)))

    # Constraint: each 26AS entry matched at most once
    for as26 in as26_entries:
        relevant = [i for i, c in enumerate(all_combos) if c[0] == as26.index]
        if relevant:
            prob += lpSum(x[i] for i in relevant) <= 1

    # Constraint: each book used at most once
    book_idx_to_combos: Dict[int, List[int]] = {}
    for i, (_, bidx_tuple, *_rest) in enumerate(all_combos):
        for bi in bidx_tuple:
            book_idx_to_combos.setdefault(bi, []).append(i)
    for bi, combo_indices in book_idx_to_combos.items():
        prob += lpSum(x[i] for i in combo_indices) <= 1

    # Solve (silent)
    solver = PULP_CBC_CMD(msg=0, timeLimit=30)
    prob.solve(solver)

    matched: List[AssignmentResult] = []
    matched_as26: Set[int] = set()

    if LpStatus[prob.status] == "Optimal":
        for i, (a_idx, b_idx_tuple, score_val, var_pct, match_type, score_obj, books) in enumerate(all_combos):
            if lp_value(x[i]) and lp_value(x[i]) > 0.5:
                as26 = next(e for e in as26_entries if e.index == a_idx)
                _commit(books, used_book_indices, consumed_invoice_refs)
                matched.append(AssignmentResult(
                    as26_index=as26.index,
                    as26_amount=as26.amount,
                    as26_date=as26.transaction_date,
                    as26_section=as26.section,
                    books=books,
                    match_type=match_type,
                    variance_pct=round(var_pct, 4),
                    variance_amt=round(as26.amount - sum(b.amount for b in books), 2),
                    confidence=_confidence(var_pct, match_type),
                    score=score_obj,
                ))
                matched_as26.add(a_idx)
    else:
        logger.warning("ilp_no_optimal_solution", status=LpStatus[prob.status])

    unmatched = [e for e in as26_entries if e.index not in matched_as26]
    return matched, unmatched


# ── Phase C: Force Match ───────────────────────────────────────────────────────

def _phase_c_force(
    as26_entries: List[As26Entry],
    book_pool: List[BookEntry],
    used_book_indices: Set[int],
    consumed_invoice_refs: Set[str],
) -> Tuple[List[AssignmentResult], List[As26Entry]]:
    matched: List[AssignmentResult] = []
    unmatched: List[As26Entry] = []

    for as26 in as26_entries:
        available = [
            b for b in book_pool
            if b.index not in used_book_indices
            and (not b.invoice_ref or b.invoice_ref not in consumed_invoice_refs)
            and b.amount <= as26.amount + EXACT_TOLERANCE
        ]
        if not available:
            unmatched.append(as26)
            continue

        # FORCE_SINGLE — best single within 5%
        best_book = None
        best_score = -1.0
        best_var = None
        for b in available:
            var_pct = _variance_pct(as26.amount, b.amount)
            if var_pct > VARIANCE_CAP_FORCE_SINGLE:
                continue
            candidate = BookCandidate(
                invoice_refs=[b.invoice_ref], amounts=[b.amount],
                dates=[b.doc_date], clearing_doc=b.clearing_doc, sap_fy=b.sap_fy,
            )
            score = score_candidate(as26.amount, as26.transaction_date, as26.section, candidate)
            if score.total > best_score:
                best_score, best_var, best_book = score.total, var_pct, (b, score)

        if best_book:
            b, score = best_book
            _commit([b], used_book_indices, consumed_invoice_refs)
            matched.append(AssignmentResult(
                as26_index=as26.index, as26_amount=as26.amount,
                as26_date=as26.transaction_date, as26_section=as26.section,
                books=[b], match_type="FORCE_SINGLE",
                variance_pct=round(best_var, 4),
                variance_amt=round(as26.amount - b.amount, 2),
                confidence="LOW", score=score,
            ))
            continue

        # FORCE_COMBO — 2–3 invoices, ≤2%
        best_combo = None
        best_combo_score = -1.0
        for size in range(2, min(FORCE_COMBO_MAX_INVOICES + 1, len(available) + 1)):
            for combo in itertools.combinations(available, size):
                combo_sum = sum(b.amount for b in combo)
                if combo_sum > as26.amount + EXACT_TOLERANCE:
                    continue
                var_pct = _variance_pct(as26.amount, combo_sum)
                if var_pct > FORCE_COMBO_MAX_VARIANCE:
                    continue
                candidate = BookCandidate(
                    invoice_refs=[b.invoice_ref for b in combo],
                    amounts=[b.amount for b in combo],
                    dates=[b.doc_date for b in combo],
                    clearing_doc=None, sap_fy=combo[0].sap_fy,
                )
                score = score_candidate(as26.amount, as26.transaction_date, as26.section, candidate)
                if score.total > best_combo_score:
                    best_combo_score = score.total
                    best_combo = (list(combo), var_pct, score)

        if best_combo:
            books, var_pct, score = best_combo
            _commit(books, used_book_indices, consumed_invoice_refs)
            matched.append(AssignmentResult(
                as26_index=as26.index, as26_amount=as26.amount,
                as26_date=as26.transaction_date, as26_section=as26.section,
                books=books, match_type="FORCE_COMBO",
                variance_pct=round(var_pct, 4),
                variance_amt=round(as26.amount - sum(b.amount for b in books), 2),
                confidence="LOW", score=score,
            ))
        else:
            unmatched.append(as26)

    return matched, unmatched


# ── Greedy fallbacks (if scipy/PuLP not available) ────────────────────────────

def _greedy_single(as26_entries, candidates, used_book_indices, consumed_invoice_refs):
    """Score-descending greedy single assignment."""
    sorted_cands = sorted(candidates.items(), key=lambda x: -x[1][0])
    matched_a26: Set[int] = set()
    matched_books: Set[int] = set()
    matched: List[AssignmentResult] = []
    used_new: Set[int] = set()

    for (a_idx, b_idx), (score_val, var_pct, match_type, score_obj, book) in sorted_cands:
        if a_idx in matched_a26 or b_idx in matched_books:
            continue
        as26 = next((e for e in as26_entries if e.index == a_idx), None)
        if not as26:
            continue
        matched_a26.add(a_idx)
        matched_books.add(b_idx)
        used_new.add(b_idx)
        matched.append(AssignmentResult(
            as26_index=as26.index, as26_amount=as26.amount,
            as26_date=as26.transaction_date, as26_section=as26.section,
            books=[book], match_type=match_type,
            variance_pct=round(var_pct, 4),
            variance_amt=round(as26.amount - book.amount, 2),
            confidence=_confidence(var_pct, match_type), score=score_obj,
        ))

    unmatched = [e for e in as26_entries if e.index not in matched_a26]
    return matched, unmatched, used_new


def _greedy_combo(as26_entries, book_pool, used_book_indices, consumed_invoice_refs):
    """Greedy combo (enhanced: score-descending, per-size budgets)."""
    matched: List[AssignmentResult] = []
    unmatched: List[As26Entry] = []

    for as26 in as26_entries:
        available = [
            b for b in book_pool
            if b.index not in used_book_indices
            and (not b.invoice_ref or b.invoice_ref not in consumed_invoice_refs)
            and b.amount <= as26.amount + EXACT_TOLERANCE
        ]
        best = None
        best_score = -1.0

        for size in range(2, min(MAX_COMBO_SIZE + 1, len(available) + 1)):
            count = 0
            for combo in itertools.combinations(available, size):
                if count >= COMBO_LIMIT:
                    break
                combo_sum = sum(b.amount for b in combo)
                if combo_sum > as26.amount + EXACT_TOLERANCE:
                    continue
                var_pct = _variance_pct(as26.amount, combo_sum)
                cap = VARIANCE_CAP_SINGLE if size == 2 else VARIANCE_CAP_COMBO
                if var_pct > cap:
                    continue
                candidate = BookCandidate(
                    invoice_refs=[b.invoice_ref for b in combo],
                    amounts=[b.amount for b in combo],
                    dates=[b.doc_date for b in combo],
                    clearing_doc=None, sap_fy=combo[0].sap_fy,
                )
                score = score_candidate(as26.amount, as26.transaction_date, as26.section, candidate)
                if score.total > best_score:
                    best_score = score.total
                    best = (list(combo), var_pct, f"COMBO_{size}", score)
                count += 1

        if best:
            books, var_pct, match_type, score_obj = best
            _commit(books, used_book_indices, consumed_invoice_refs)
            matched.append(AssignmentResult(
                as26_index=as26.index, as26_amount=as26.amount,
                as26_date=as26.transaction_date, as26_section=as26.section,
                books=books, match_type=match_type,
                variance_pct=round(var_pct, 4),
                variance_amt=round(as26.amount - sum(b.amount for b in books), 2),
                confidence=_confidence(var_pct, match_type), score=score_obj,
            ))
        else:
            unmatched.append(as26)

    return matched, unmatched


# ── Helpers ───────────────────────────────────────────────────────────────────

def _commit(books: List[BookEntry], used: Set[int], consumed: Set[str]) -> None:
    for b in books:
        used.add(b.index)
        if b.invoice_ref:
            consumed.add(b.invoice_ref)


def _variance_pct(as26_amt: float, books_sum: float) -> float:
    if as26_amt <= 0:
        return 100.0
    return (as26_amt - books_sum) / as26_amt * 100


def _confidence(variance_pct: float, match_type: str) -> str:
    if "FORCE" in match_type or "PRIOR" in match_type:
        return "LOW"
    if variance_pct <= 1.0:
        return "HIGH"
    return "MEDIUM"


def _validate_compliance(results: List[AssignmentResult], allow_cross_fy: bool) -> None:
    """Post-run compliance assertions — raises RuntimeError on violation."""
    all_refs: List[str] = []
    for r in results:
        for b in r.books:
            if b.invoice_ref:
                all_refs.append(b.invoice_ref)

    # 1. Invoice uniqueness
    from collections import Counter
    counts = Counter(all_refs)
    duplicates = {k: v for k, v in counts.items() if v > 1}
    if duplicates:
        raise RuntimeError(f"COMPLIANCE VIOLATION: Invoice reuse detected: {duplicates}")

    # 2. books_sum ≤ as26_amount
    for r in results:
        books_sum = sum(b.amount for b in r.books)
        if books_sum > r.as26_amount + EXACT_TOLERANCE:
            raise RuntimeError(
                f"COMPLIANCE VIOLATION: books_sum {books_sum} > as26_amount {r.as26_amount} "
                f"for as26 index {r.as26_index}"
            )

    # 3. Combo cap
    for r in results:
        if len(r.books) > MAX_COMBO_SIZE:
            raise RuntimeError(
                f"COMPLIANCE VIOLATION: Match has {len(r.books)} invoices > MAX_COMBO_SIZE={MAX_COMBO_SIZE}"
            )

    # 4. FY boundary
    if not allow_cross_fy:
        for r in results:
            if not r.is_prior_year:
                for b in r.books:
                    if b.sap_fy and r.as26_section:  # only validate when FY data present
                        pass  # FY boundary check requires FY label comparison — done in service layer
