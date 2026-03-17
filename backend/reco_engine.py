"""
TDS Reconciliation Engine — v3 with Force-Matching
Pure function: run_reco(clean_books, as26_entries, ...) → RecoResult

Algorithm (v3):
    Phase A — Clearing Group Matching (5% cap)
      1. Build clearing groups from SAP (group by clearing_doc, sum amounts)
      2. For each 26AS entry sorted ascending by amount:
         a. Try exact match against clearing group totals
         b. Try closest clearing group (within 5% tolerance)
      3. Commit if variance ≤ 5%, else skip to Phase B

    Phase B — Individual Invoice Matching (5% cap)
      1. Round 1: Exact match (abs diff < 0.01)
      2. Round 2: Best single invoice (lowest diff, books ≤ as26)
      3. Round 3: Best combo (itertools combinations up to MAX_COMBO_SIZE)
      4. Commit ONLY if variance ≤ 5% → HIGH/MEDIUM confidence

    Phase C — Force-Match Remaining (NO cap, greedy closest)
      For every still-unmatched 26AS entry, find the BEST available books
      regardless of variance. This ensures near-zero unmatched 26AS.
      Matched as LOW confidence with FORCE_* match type.
      Process DESCENDING by amount (largest first gets best picks).

    Phase D — Classify truly unmatched
      Only 26AS entries with ZERO available books remaining go here.

Legal constraint (Section 199):
    books_sum MUST NEVER exceed as26_amount. Enforced at assertion level.
"""
from __future__ import annotations

import itertools
import logging
import uuid
from collections import defaultdict
from typing import Dict, List, Optional, Set, Tuple

import pandas as pd

from config import (
    COMBO_LIMIT,
    EXACT_TOLERANCE,
    MAX_COMBO_SIZE,
    VARIANCE_CAP_PCT,
)
from models import (
    As26Entry,
    BookEntry,
    MatchedPair,
    RecoResult,
    UnmatchedAs26Entry,
)

logger = logging.getLogger(__name__)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _confidence(variance_pct: float) -> str:
    """Assign confidence tier based on variance."""
    if abs(variance_pct) <= 1.0:
        return "HIGH"
    elif abs(variance_pct) <= VARIANCE_CAP_PCT:
        return "MEDIUM"
    else:
        return "LOW"


def _df_to_book_entries(clean_df: pd.DataFrame) -> List[BookEntry]:
    entries = []
    for idx, row in clean_df.iterrows():
        entries.append(BookEntry(
            index=int(idx),
            doc_date=row.get("doc_date"),
            amount=float(row["amount"]),
            invoice_ref=str(row.get("invoice_ref", "")),
            doc_type=str(row.get("doc_type", "")),
            sgl_ind=str(row.get("sgl_ind", "")),
            flag=str(row.get("flag", "")),
            clearing_doc=str(row.get("clearing_doc", "")),
            sap_fy=str(row.get("sap_fy", "")),
        ))
    return entries


def _df_to_as26_entries(as26_slice: pd.DataFrame) -> List[As26Entry]:
    entries = []
    for idx, row in as26_slice.iterrows():
        entries.append(As26Entry(
            index=int(idx),
            transaction_date=row.get("transaction_date"),
            amount=float(row["amount"]),
            section=str(row.get("section", "")),
            tan=str(row.get("tan", "")),
            deductor_name=str(row.get("deductor_name", "")),
        ))
    return entries


def _variance_pct(as26_amt: float, books_sum: float) -> float:
    if as26_amt <= 0:
        return 0.0
    return (as26_amt - books_sum) / as26_amt * 100


def _build_matched_pair(
    as26: As26Entry,
    books: List[BookEntry],
    match_type: str,
    target_fy: str,
) -> MatchedPair:
    """Build a MatchedPair from an as26 entry and its matched book entries."""
    books_sum = sum(b.amount for b in books)
    var_amt = as26.amount - books_sum
    var_pct = _variance_pct(as26.amount, books_sum)
    fys = [b.sap_fy for b in books]
    cross = any(fy != target_fy and fy != "" for fy in fys) if target_fy else False

    return MatchedPair(
        as26_index=as26.index,
        as26_date=as26.transaction_date,
        as26_amount=as26.amount,
        section=as26.section,
        books_sum=books_sum,
        variance_amt=var_amt,
        variance_pct=round(var_pct, 4),
        match_type=match_type,
        confidence=_confidence(var_pct),
        invoice_count=len(books),
        invoice_refs=[b.invoice_ref for b in books],
        invoice_dates=[b.doc_date for b in books],
        invoice_amounts=[b.amount for b in books],
        sgl_flags=[b.flag for b in books],
        clearing_docs=list(set(b.clearing_doc for b in books if b.clearing_doc)),
        sap_fys=fys,
        cross_fy=cross,
    )


# ── Phase A: Clearing Group Matching ─────────────────────────────────────────

def _build_clearing_groups(
    book_entries: List[BookEntry],
) -> Dict[str, List[BookEntry]]:
    """
    Group book entries by Clearing Document.
    Returns {clearing_doc: [BookEntry, ...]} for groups with 2+ entries.
    Single-entry groups are handled in Phase B individual matching.
    """
    groups: Dict[str, List[BookEntry]] = defaultdict(list)
    for b in book_entries:
        if b.clearing_doc:
            groups[b.clearing_doc].append(b)
    # Only return groups with 2+ invoices (single entries handled individually)
    return {k: v for k, v in groups.items() if len(v) >= 2}


def _try_clearing_group_match(
    as26: As26Entry,
    clearing_groups: Dict[str, List[BookEntry]],
    used_book_indices: Set[int],
    used_clearing_docs: Set[str],
) -> Optional[Tuple[List[BookEntry], str, float]]:
    """
    Try to match a 26AS entry against clearing group totals.
    Returns (matched_books, match_type, variance_pct) or None.
    """
    best_books: Optional[List[BookEntry]] = None
    best_diff = float("inf")
    best_var_pct = float("inf")

    for clr_doc, group_books in clearing_groups.items():
        if clr_doc in used_clearing_docs:
            continue

        # Filter out already-used books from this group
        available_in_group = [
            b for b in group_books if b.index not in used_book_indices
        ]
        if len(available_in_group) < 2:
            continue

        group_sum = sum(b.amount for b in available_in_group)

        # Legal constraint: books_sum must not exceed as26_amount
        if group_sum > as26.amount + EXACT_TOLERANCE:
            continue

        diff = abs(as26.amount - group_sum)
        var_pct = _variance_pct(as26.amount, group_sum)

        # Phase A uses variance cap for quality matching
        if abs(var_pct) > VARIANCE_CAP_PCT:
            continue

        if diff < best_diff:
            best_diff = diff
            best_books = available_in_group
            best_var_pct = var_pct

    if best_books is not None:
        match_type = f"CLR_GROUP_{len(best_books)}"
        return best_books, match_type, best_var_pct

    return None


# ── Phase B: Individual Invoice Matching (with 5% cap) ───────────────────────

def _try_individual_match(
    as26: As26Entry,
    book_entries: List[BookEntry],
    used_book_indices: Set[int],
) -> Optional[Tuple[List[BookEntry], str, float]]:
    """
    3-round individual match (Exact → Single → Combo).
    Returns (matched_books, match_type, variance_pct) or None.
    Only returns matches within VARIANCE_CAP_PCT (5%).
    """
    available = [
        b for b in book_entries
        if b.index not in used_book_indices
        and b.amount <= as26.amount + EXACT_TOLERANCE
    ]
    if not available:
        return None

    best_books: Optional[List[BookEntry]] = None
    best_diff = float("inf")
    best_match_type = ""

    # ── Round 1: Exact match ─────────────────────────────────────────────
    for b in available:
        if abs(b.amount - as26.amount) < EXACT_TOLERANCE:
            best_books = [b]
            best_diff = abs(b.amount - as26.amount)
            best_match_type = "EXACT"
            break

    # ── Round 2: Best single ─────────────────────────────────────────────
    if best_books is None:
        for b in available:
            diff = abs(as26.amount - b.amount)
            if diff < best_diff:
                best_diff = diff
                best_books = [b]
                best_match_type = "SINGLE"

    # ── Round 3: Combo (may improve on single) ───────────────────────────
    if best_match_type != "EXACT":
        combo_count = 0
        for size in range(2, min(MAX_COMBO_SIZE + 1, len(available) + 1)):
            if combo_count >= COMBO_LIMIT:
                break
            for combo in itertools.combinations(available, size):
                if combo_count >= COMBO_LIMIT:
                    break
                combo_count += 1
                combo_sum = sum(b.amount for b in combo)
                if combo_sum > as26.amount + EXACT_TOLERANCE:
                    continue
                diff = abs(as26.amount - combo_sum)
                if diff < best_diff:
                    best_diff = diff
                    best_books = list(combo)
                    best_match_type = f"COMBO_{size}"

    if best_books is None:
        return None

    books_sum = sum(b.amount for b in best_books)

    # Legal assertion
    if books_sum > as26.amount + EXACT_TOLERANCE:
        return None

    var_pct = _variance_pct(as26.amount, books_sum)

    # Phase B: Hard variance cap — reject if over 5% (Phase C will handle these)
    if abs(var_pct) > VARIANCE_CAP_PCT:
        return None

    return best_books, best_match_type, var_pct


# ── Phase C: Force-Match (NO variance cap, greedy closest) ───────────────────

def _try_force_match(
    as26: As26Entry,
    book_entries: List[BookEntry],
    used_book_indices: Set[int],
) -> Optional[Tuple[List[BookEntry], str, float]]:
    """
    Find the BEST available books for a 26AS entry regardless of variance.
    Used in Phase C for entries that couldn't match within the 5% cap.
    Still respects the legal constraint (books_sum ≤ as26_amount).

    Strategy:
      1. Try exact match (very unlikely at this stage but check anyway)
      2. Greedy accumulation: sort books descending, greedily pack
      3. Best single book (closest to 26AS amount)
      4. Combo search with itertools (improved with higher COMBO_LIMIT)
      5. Return the best match found (closest to as26_amount)
    """
    available = [
        b for b in book_entries
        if b.index not in used_book_indices
        and b.amount <= as26.amount + EXACT_TOLERANCE
    ]
    if not available:
        return None

    best_books: Optional[List[BookEntry]] = None
    best_diff = float("inf")
    best_match_type = ""

    # ── Round 1: Exact match ─────────────────────────────────────────────
    for b in available:
        if abs(b.amount - as26.amount) < EXACT_TOLERANCE:
            return [b], "FORCE_EXACT", 0.0

    # ── Round 2: Greedy accumulation (new optimization) ──────────────────
    # Sort available books descending by amount, greedily pack as many as
    # possible without exceeding as26_amount
    sorted_avail = sorted(available, key=lambda b: b.amount, reverse=True)
    greedy_combo: List[BookEntry] = []
    greedy_sum = 0.0
    for b in sorted_avail:
        if greedy_sum + b.amount <= as26.amount + EXACT_TOLERANCE:
            greedy_combo.append(b)
            greedy_sum += b.amount
    if greedy_combo:
        diff = abs(as26.amount - greedy_sum)
        if diff < best_diff:
            best_diff = diff
            best_books = greedy_combo
            if len(greedy_combo) == 1:
                best_match_type = "FORCE_SINGLE"
            else:
                best_match_type = f"FORCE_COMBO_{len(greedy_combo)}"

    # ── Round 3: Best single book ────────────────────────────────────────
    for b in available:
        diff = abs(as26.amount - b.amount)
        if diff < best_diff:
            best_diff = diff
            best_books = [b]
            best_match_type = "FORCE_SINGLE"

    # ── Round 4: Combo search (may improve on greedy/single) ─────────────
    combo_count = 0
    for size in range(2, min(MAX_COMBO_SIZE + 1, len(available) + 1)):
        if combo_count >= COMBO_LIMIT:
            break
        for combo in itertools.combinations(available, size):
            if combo_count >= COMBO_LIMIT:
                break
            combo_count += 1
            combo_sum = sum(b.amount for b in combo)
            if combo_sum > as26.amount + EXACT_TOLERANCE:
                continue
            diff = abs(as26.amount - combo_sum)
            if diff < best_diff:
                best_diff = diff
                best_books = list(combo)
                best_match_type = f"FORCE_COMBO_{size}"

    if best_books is None:
        return None

    books_sum = sum(b.amount for b in best_books)

    # Legal constraint (still enforced)
    if books_sum > as26.amount + EXACT_TOLERANCE:
        return None

    var_pct = _variance_pct(as26.amount, books_sum)

    # NO variance cap check — this is force-matching
    return best_books, best_match_type, var_pct


# ── Phase D: Diagnostics for truly unmatched ─────────────────────────────────

def _find_best_rejected_candidate(
    as26: As26Entry,
    book_entries: List[BookEntry],
    used_book_indices: Set[int],
) -> Tuple[Optional[str], Optional[float], Optional[float], str]:
    """
    For a truly unmatched 26AS entry (no books available at all),
    explain why no match was possible.
    """
    available = [
        b for b in book_entries
        if b.index not in used_book_indices
        and b.amount <= as26.amount + EXACT_TOLERANCE
    ]
    if not available:
        # Check if there are ANY unused books (but all exceed as26_amount)
        all_unused = [b for b in book_entries if b.index not in used_book_indices]
        if all_unused:
            return None, None, None, "All remaining SAP invoices exceed 26AS amount"
        return None, None, None, "No SAP invoices remaining (all consumed by other matches)"

    # This shouldn't happen in Phase D since Phase C would have matched it
    best = min(available, key=lambda b: abs(as26.amount - b.amount))
    var_pct = _variance_pct(as26.amount, best.amount)
    return best.invoice_ref, best.amount, round(var_pct, 2), "Unexpected — should have been force-matched"


# ── Main entry point ─────────────────────────────────────────────────────────

def run_reco(
    clean_df: pd.DataFrame,
    as26_slice: pd.DataFrame,
    deductor_name: str,
    tan: str,
    fuzzy_score: Optional[float],
    session_id: Optional[str] = None,
    target_fy: str = "",
) -> RecoResult:
    """
    Run the 3-phase reconciliation:
      Phase A: Clearing Groups (5% cap)
      Phase B: Individual matching (5% cap)
      Phase C: Force-match remaining (no cap) → LOW confidence
      Phase D: Classify truly unmatched (zero books available)
    """
    if session_id is None:
        session_id = str(uuid.uuid4())

    book_entries = _df_to_book_entries(clean_df)
    as26_entries = _df_to_as26_entries(as26_slice)

    # Sort 26AS ascending by amount (small first) for Phases A+B
    as26_entries.sort(key=lambda x: x.amount)

    used_book_indices: Set[int] = set()
    used_clearing_docs: Set[str] = set()
    matched_pairs: List[MatchedPair] = []
    constraint_violations = 0

    # ── Phase A: Clearing Group Matching (5% cap) ─────────────────────────
    clearing_groups = _build_clearing_groups(book_entries)
    phase_a_remaining: List[As26Entry] = []

    for as26 in as26_entries:
        result = _try_clearing_group_match(
            as26, clearing_groups, used_book_indices, used_clearing_docs,
        )
        if result is not None:
            books, match_type, var_pct = result
            # Commit
            for b in books:
                used_book_indices.add(b.index)
            # Mark clearing doc as used
            for b in books:
                if b.clearing_doc:
                    used_clearing_docs.add(b.clearing_doc)

            pair = _build_matched_pair(as26, books, match_type, target_fy)
            matched_pairs.append(pair)
        else:
            phase_a_remaining.append(as26)

    phase_a_count = len(matched_pairs)
    logger.info(
        "Phase A (Clearing Groups): %d/%d matched | %d groups available",
        phase_a_count, len(as26_entries), len(clearing_groups),
    )

    # ── Phase B: Individual Invoice Matching (5% cap) ─────────────────────
    phase_b_unmatched: List[As26Entry] = []

    for as26 in phase_a_remaining:
        result = _try_individual_match(as26, book_entries, used_book_indices)
        if result is not None:
            books, match_type, var_pct = result
            # Legal assertion
            books_sum = sum(b.amount for b in books)
            if books_sum > as26.amount + EXACT_TOLERANCE:
                constraint_violations += 1
                phase_b_unmatched.append(as26)
                continue
            # Commit
            for b in books:
                used_book_indices.add(b.index)
            pair = _build_matched_pair(as26, books, match_type, target_fy)
            matched_pairs.append(pair)
        else:
            phase_b_unmatched.append(as26)

    phase_b_count = len(matched_pairs) - phase_a_count
    logger.info(
        "Phase B (Individual): %d more matched | %d remaining for force-match",
        phase_b_count, len(phase_b_unmatched),
    )

    # ── Phase C: Force-Match Remaining (NO variance cap) ──────────────────
    # Process DESCENDING by amount — largest unmatched entries get first pick
    phase_b_unmatched.sort(key=lambda x: x.amount, reverse=True)
    phase_c_unmatched: List[As26Entry] = []

    for as26 in phase_b_unmatched:
        result = _try_force_match(as26, book_entries, used_book_indices)
        if result is not None:
            books, match_type, var_pct = result
            # Legal assertion (still enforced)
            books_sum = sum(b.amount for b in books)
            if books_sum > as26.amount + EXACT_TOLERANCE:
                constraint_violations += 1
                phase_c_unmatched.append(as26)
                continue
            # Commit
            for b in books:
                used_book_indices.add(b.index)
            pair = _build_matched_pair(as26, books, match_type, target_fy)
            matched_pairs.append(pair)
        else:
            phase_c_unmatched.append(as26)

    phase_c_count = len(matched_pairs) - phase_a_count - phase_b_count
    logger.info(
        "Phase C (Force-Match): %d more matched | %d truly unmatched (no books available)",
        phase_c_count, len(phase_c_unmatched),
    )

    # ── Phase D: Classify truly unmatched (zero available books) ──────────
    unmatched_26as: List[UnmatchedAs26Entry] = []
    for as26 in phase_c_unmatched:
        ref, amt, var, reason = _find_best_rejected_candidate(
            as26, book_entries, used_book_indices,
        )
        unmatched_26as.append(UnmatchedAs26Entry(
            index=as26.index,
            transaction_date=as26.transaction_date,
            amount=as26.amount,
            section=as26.section,
            tan=as26.tan,
            deductor_name=as26.deductor_name,
            best_candidate_ref=ref,
            best_candidate_amount=amt,
            best_candidate_variance_pct=var,
            rejection_reason=reason,
        ))

    unmatched_books = [
        b for b in book_entries if b.index not in used_book_indices
    ]

    # ── Summary stats ────────────────────────────────────────────────────
    total_26as = len(as26_entries)
    matched_count = len(matched_pairs)
    match_rate = (matched_count / total_26as * 100) if total_26as > 0 else 0.0
    avg_variance = (
        sum(p.variance_pct for p in matched_pairs) / matched_count
        if matched_count > 0 else 0.0
    )
    high_conf = sum(1 for p in matched_pairs if p.confidence == "HIGH")
    med_conf  = sum(1 for p in matched_pairs if p.confidence == "MEDIUM")
    low_conf  = sum(1 for p in matched_pairs if p.confidence == "LOW")
    cross_fy  = sum(1 for p in matched_pairs if p.cross_fy)

    logger.info(
        "Reco complete: %d/%d matched (%.1f%%) | avg_var=%.2f%% | violations=%d | "
        "HIGH=%d MEDIUM=%d LOW=%d | cross_fy=%d | unmatched_26as=%d | unmatched_books=%d",
        matched_count, total_26as, match_rate,
        avg_variance, constraint_violations,
        high_conf, med_conf, low_conf, cross_fy,
        len(unmatched_26as), len(unmatched_books),
    )

    return RecoResult(
        deductor_name=deductor_name,
        tan=tan,
        fuzzy_score=fuzzy_score,
        total_26as_entries=total_26as,
        matched_count=matched_count,
        match_rate_pct=round(match_rate, 2),
        unmatched_26as_count=len(unmatched_26as),
        unmatched_books_count=len(unmatched_books),
        avg_variance_pct=round(avg_variance, 2),
        constraint_violations=constraint_violations,
        high_confidence_count=high_conf,
        medium_confidence_count=med_conf,
        low_confidence_count=low_conf,
        cross_fy_match_count=cross_fy,
        matched_pairs=matched_pairs,
        unmatched_26as=unmatched_26as,
        unmatched_books=unmatched_books,
        session_id=session_id,
    )
