"""
TDS Reconciliation Engine — v5 (Change Request Brief compliance, March 2026)
Pure function: run_reco(clean_books, as26_entries, ...) → RecoResult

Algorithm (v5 — all P0/P1 issues addressed):

    Phase A — Clearing Group Matching (3% cap, MAX_COMBO_SIZE=5 cap)
      Groups > MAX_COMBO_SIZE entries are skipped entirely (not truncated).
      Only groups with 2–5 entries are eligible. Variance cap: 3%.

    Phase B — Individual Invoice Matching (tier-specific caps)
      EXACT   : abs diff < ₹0.01
      SINGLE  : ≤ 2% variance
      COMBO_2 : ≤ 2% variance
      COMBO_3–5: ≤ 3% variance
      Combo budget is PER SIZE (COMBO_LIMIT per size level), not shared.
      Near-exact early exit (< 0.5% of 26AS amount) saves budget.

    Phase C — Restricted Force-Match
      FORCE_SINGLE : 1 invoice, ≤ 5% variance. Last resort.
      FORCE_COMBO  : 2–3 invoices, ≤ 2% variance. Very tight — near-exact only.
      If no match within these ceilings, entry skips to Phase E or Phase D.
      (Brief §3/#3: FORCE_COMBO_529-style matches are impossible here.)

    Phase E — Prior-Year Exception  [runs only when ALLOW_CROSS_FY = False]
      Remaining unmatched 26AS entries are tried against prior-FY books
      using Phase B matching logic (same variance ceilings).
      Matches tagged PRIOR_{match_type}, cross_fy=True, confidence=LOW.
      CAs must explicitly review and approve these before signing workpapers.

    Phase D — Classify truly unmatched
      Carries structured reason code (U01/U02/U04) for CA investigation.

Compliance rules enforced:
    1. books_sum MUST NEVER exceed as26_amount (Section 199, hard assert).
    2. Each invoice_ref used in at most ONE match (consumed_invoice_refs set).
    3. ALLOW_CROSS_FY=False: prior-FY books excluded from Phases A/B/C.
    4. MAX_COMBO_SIZE=5 enforced in all phases including CLR_GROUP.
    5. Post-run validation: invoice uniqueness + books≤26AS + combo cap + FY boundary.
"""
from __future__ import annotations

import itertools
import logging
import uuid
from collections import Counter, defaultdict
from typing import Dict, List, Optional, Set, Tuple

import pandas as pd

from config import (
    ALLOW_CROSS_FY,
    COMBO_LIMIT,
    EXACT_TOLERANCE,
    FORCE_COMBO_MAX_INVOICES,
    FORCE_COMBO_MAX_VARIANCE,
    MAX_COMBO_SIZE,
    VARIANCE_CAP_CLR_GROUP,
    VARIANCE_CAP_COMBO,
    VARIANCE_CAP_FORCE_SINGLE,
    VARIANCE_CAP_SINGLE,
)
from models import (
    As26Entry,
    BookEntry,
    MatchedPair,
    RecoResult,
    UnmatchedAs26Entry,
)

logger = logging.getLogger(__name__)

# Per-size combo limit for Phase C force-match (only 2–3 invoices anyway)
_FORCE_COMBO_LIMIT = 500


# ── Helpers ──────────────────────────────────────────────────────────────────

def _confidence(variance_pct: float, match_type: str = "") -> str:
    """
    Confidence tier based on variance AND match type.
    FORCE/PRIOR matches are always LOW — requires CA explicit sign-off
    regardless of how tight the variance happens to be.
    """
    mt = match_type.upper()
    if mt.startswith("FORCE") or mt.startswith("PRIOR"):
        return "LOW"
    if abs(variance_pct) <= 1.0:
        return "HIGH"
    return "MEDIUM"


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
        confidence=_confidence(var_pct, match_type),
        invoice_count=len(books),
        invoice_refs=[b.invoice_ref for b in books],
        invoice_dates=[b.doc_date for b in books],
        invoice_amounts=[b.amount for b in books],
        sgl_flags=[b.flag for b in books],
        clearing_docs=list(set(b.clearing_doc for b in books if b.clearing_doc)),
        sap_fys=fys,
        cross_fy=cross,
    )


def _get_available(
    as26: As26Entry,
    book_pool: List[BookEntry],
    used_book_indices: Set[int],
    consumed_invoice_refs: Set[str],
) -> List[BookEntry]:
    """
    Filter the pool to books eligible for this 26AS entry:
      - Not already consumed (by index)
      - Amount ≤ 26AS amount (Section 199 legal constraint)
      - Invoice ref not already used in another match (Section 199 invoice uniqueness)
    """
    return [
        b for b in book_pool
        if b.index not in used_book_indices
        and b.amount <= as26.amount + EXACT_TOLERANCE
        and (not b.invoice_ref or b.invoice_ref not in consumed_invoice_refs)
    ]


def _commit(
    books: List[BookEntry],
    used_book_indices: Set[int],
    consumed_invoice_refs: Set[str],
) -> None:
    """Mark books as used so they cannot appear in any subsequent match."""
    for b in books:
        used_book_indices.add(b.index)
        if b.invoice_ref:
            consumed_invoice_refs.add(b.invoice_ref)


# ── Phase A: Clearing Group Matching ─────────────────────────────────────────

def _build_clearing_groups(
    book_pool: List[BookEntry],
) -> Dict[str, List[BookEntry]]:
    """
    Group books by clearing document number.
    Only returns groups with 2 to MAX_COMBO_SIZE entries.
    Larger groups (e.g., 37-invoice clearing batches) are excluded:
      they are payment mechanics, not TDS deduction logic, and produce
      statistically meaningless matches (Brief §3/#5).
    """
    groups: Dict[str, List[BookEntry]] = defaultdict(list)
    for b in book_pool:
        if b.clearing_doc:
            groups[b.clearing_doc].append(b)

    eligible = {}
    skipped = 0
    for clr_doc, grp in groups.items():
        if 2 <= len(grp) <= MAX_COMBO_SIZE:
            eligible[clr_doc] = grp
        elif len(grp) > MAX_COMBO_SIZE:
            skipped += 1
            logger.debug(
                "CLR group %s: %d invoices > MAX_COMBO_SIZE=%d — excluded from Phase A",
                clr_doc, len(grp), MAX_COMBO_SIZE,
            )

    if skipped:
        logger.info(
            "Phase A: %d clearing groups skipped (size > %d); %d eligible",
            skipped, MAX_COMBO_SIZE, len(eligible),
        )
    return eligible


def _try_clearing_group_match(
    as26: As26Entry,
    clearing_groups: Dict[str, List[BookEntry]],
    used_book_indices: Set[int],
    used_clearing_docs: Set[str],
    consumed_invoice_refs: Set[str],
) -> Optional[Tuple[List[BookEntry], str, float]]:
    """
    Match a 26AS entry against eligible clearing groups (≤ MAX_COMBO_SIZE entries).
    Variance cap: VARIANCE_CAP_CLR_GROUP (3%).
    """
    best_books: Optional[List[BookEntry]] = None
    best_diff = float("inf")

    for clr_doc, group_books in clearing_groups.items():
        if clr_doc in used_clearing_docs:
            continue

        available = [
            b for b in group_books
            if b.index not in used_book_indices
            and (not b.invoice_ref or b.invoice_ref not in consumed_invoice_refs)
        ]
        if len(available) < 2 or len(available) > MAX_COMBO_SIZE:
            continue

        group_sum = sum(b.amount for b in available)
        if group_sum > as26.amount + EXACT_TOLERANCE:
            continue

        var_pct = _variance_pct(as26.amount, group_sum)
        if abs(var_pct) > VARIANCE_CAP_CLR_GROUP:
            continue

        diff = abs(as26.amount - group_sum)
        if diff < best_diff:
            best_diff = diff
            best_books = available

    if best_books is None:
        return None

    group_sum = sum(b.amount for b in best_books)
    return best_books, f"CLR_GROUP_{len(best_books)}", _variance_pct(as26.amount, group_sum)


# ── Phase B: Individual Invoice Matching ─────────────────────────────────────

def _try_individual_match(
    as26: As26Entry,
    book_pool: List[BookEntry],
    used_book_indices: Set[int],
    consumed_invoice_refs: Set[str],
) -> Optional[Tuple[List[BookEntry], str, float]]:
    """
    Tier-specific variance caps (Brief §3/#4):
      EXACT   → within ₹0.01
      SINGLE  → ≤ 2%
      COMBO_2 → ≤ 2%
      COMBO_3 to COMBO_5 → ≤ 3%
    Combo budget is PER SIZE (COMBO_LIMIT per level).
    Near-exact early exit prevents wasting budget on marginally better combos.
    """
    available = _get_available(as26, book_pool, used_book_indices, consumed_invoice_refs)
    if not available:
        return None

    cap_books: Optional[List[BookEntry]] = None
    cap_diff = float("inf")
    cap_match_type = ""

    # ── Round 1: Exact ────────────────────────────────────────────────────
    for b in available:
        if abs(b.amount - as26.amount) < EXACT_TOLERANCE:
            return [b], "EXACT", _variance_pct(as26.amount, b.amount)

    # ── Round 2: Best single within 2% ───────────────────────────────────
    for b in available:
        diff = abs(as26.amount - b.amount)
        var_pct = _variance_pct(as26.amount, b.amount)
        if abs(var_pct) <= VARIANCE_CAP_SINGLE and diff < cap_diff:
            cap_diff = diff
            cap_books = [b]
            cap_match_type = "SINGLE"

    # ── Round 3: Combo search with per-size caps ──────────────────────────
    # COMBO_2: 2%, COMBO_3–5: 3%. Budget is per size level.
    found_near_exact = False
    for size in range(2, min(MAX_COMBO_SIZE + 1, len(available) + 1)):
        if found_near_exact:
            break
        tier_cap = VARIANCE_CAP_SINGLE if size == 2 else VARIANCE_CAP_COMBO
        per_size_count = 0
        for combo in itertools.combinations(available, size):
            if per_size_count >= COMBO_LIMIT:
                break
            per_size_count += 1
            combo_sum = sum(b.amount for b in combo)
            if combo_sum > as26.amount + EXACT_TOLERANCE:
                continue
            diff = abs(as26.amount - combo_sum)
            var_pct = _variance_pct(as26.amount, combo_sum)
            if abs(var_pct) <= tier_cap and diff < cap_diff:
                cap_diff = diff
                cap_books = list(combo)
                cap_match_type = f"COMBO_{size}"
                # Near-exact (< 0.5%): stop spending budget, move on
                if diff < as26.amount * 0.005:
                    found_near_exact = True
                    break

    if cap_books is None:
        return None

    books_sum = sum(b.amount for b in cap_books)
    if books_sum > as26.amount + EXACT_TOLERANCE:
        return None

    return cap_books, cap_match_type, _variance_pct(as26.amount, books_sum)


# ── Phase C: Restricted Force-Match ─────────────────────────────────────────

def _try_force_match(
    as26: As26Entry,
    book_pool: List[BookEntry],
    used_book_indices: Set[int],
    consumed_invoice_refs: Set[str],
) -> Optional[Tuple[List[BookEntry], str, float]]:
    """
    Last-resort matching with strict ceilings per Brief §3/#3 and §3/#4:
      FORCE_SINGLE : 1 invoice, ≤ VARIANCE_CAP_FORCE_SINGLE (5%)
      FORCE_COMBO  : 2–FORCE_COMBO_MAX_INVOICES invoices, ≤ FORCE_COMBO_MAX_VARIANCE (2%)

    FORCE_COMBO is intentionally tight: 2% cap means only near-exact multi-invoice
    sums are accepted. This eliminates the 'statistical certainty' problem where
    large sets of invoices can approximate any target amount trivially.
    Large greedy combos (FORCE_COMBO_529 etc.) are impossible here.

    Returns None if no match meets these ceilings → entry goes to Phase E or Phase D.
    """
    available = _get_available(as26, book_pool, used_book_indices, consumed_invoice_refs)
    if not available:
        return None

    best_books: Optional[List[BookEntry]] = None
    best_diff = float("inf")
    best_match_type = ""

    # ── Round 1: Exact ────────────────────────────────────────────────────
    for b in available:
        if abs(b.amount - as26.amount) < EXACT_TOLERANCE:
            return [b], "FORCE_EXACT", 0.0

    # ── Round 2: FORCE_SINGLE (≤ 5%) ─────────────────────────────────────
    for b in available:
        diff = abs(as26.amount - b.amount)
        var_pct = _variance_pct(as26.amount, b.amount)
        if abs(var_pct) <= VARIANCE_CAP_FORCE_SINGLE and diff < best_diff:
            best_diff = diff
            best_books = [b]
            best_match_type = "FORCE_SINGLE"

    # ── Round 3: FORCE_COMBO (2–3 invoices, ≤ 2%) ────────────────────────
    # Tight ceiling: only near-exact multi-invoice sums qualify.
    for size in range(2, min(FORCE_COMBO_MAX_INVOICES + 1, len(available) + 1)):
        per_size_count = 0
        for combo in itertools.combinations(available, size):
            if per_size_count >= _FORCE_COMBO_LIMIT:
                break
            per_size_count += 1
            combo_sum = sum(b.amount for b in combo)
            if combo_sum > as26.amount + EXACT_TOLERANCE:
                continue
            diff = abs(as26.amount - combo_sum)
            var_pct = _variance_pct(as26.amount, combo_sum)
            if abs(var_pct) <= FORCE_COMBO_MAX_VARIANCE and diff < best_diff:
                best_diff = diff
                best_books = list(combo)
                best_match_type = f"FORCE_COMBO_{size}"
                if diff < EXACT_TOLERANCE:
                    break  # Exact — can't improve

    if best_books is None:
        return None

    books_sum = sum(b.amount for b in best_books)
    if books_sum > as26.amount + EXACT_TOLERANCE:
        return None

    return best_books, best_match_type, _variance_pct(as26.amount, books_sum)


# ── Phase D: Classify truly unmatched ────────────────────────────────────────

def _classify_unmatched(
    as26: As26Entry,
    all_books: List[BookEntry],
    used_book_indices: Set[int],
    consumed_invoice_refs: Set[str],
) -> Tuple[Optional[str], Optional[float], Optional[float], str]:
    """
    Explain why an entry could not be matched. Checks all books (both FYs)
    so the reason accurately reflects what was available vs what was consumed.
    Reason codes (Brief §4):
      U01 — No candidate within variance ceiling (amount mismatch too large)
      U02 — All candidate invoices already consumed by earlier matches
      U04 — Only prior-year invoices available and ALLOW_CROSS_FY=False
    """
    all_unused = [b for b in all_books if b.index not in used_book_indices]
    within_legal = [b for b in all_unused if b.amount <= as26.amount + EXACT_TOLERANCE]

    if not all_unused:
        return None, None, None, "[U02] No SAP invoices remaining — all consumed by other matches"

    if not within_legal:
        return None, None, None, "[U01] All remaining SAP invoices exceed 26AS amount"

    # Check if invoice refs are all consumed
    unconstrained = [
        b for b in within_legal
        if not b.invoice_ref or b.invoice_ref not in consumed_invoice_refs
    ]
    if not unconstrained:
        return None, None, None, "[U02] All candidate invoice refs already used in other matches"

    best = min(unconstrained, key=lambda b: abs(as26.amount - b.amount))
    var_pct = _variance_pct(as26.amount, best.amount)
    coverage = 100 - round(abs(var_pct), 1)
    reason = (
        f"[U01] Best available SAP invoice covers {coverage:.1f}% of 26AS amount "
        f"(variance {round(abs(var_pct), 1):.1f}%) — exceeds tier ceiling; investigate manually"
    )
    return best.invoice_ref, best.amount, round(var_pct, 2), reason


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
    Run the 5-phase reconciliation per Change Request Brief (March 2026).
    Phase A → B → C → E (Prior-Year) → D (Truly Unmatched) → Post-Run Validation.
    """
    if session_id is None:
        session_id = str(uuid.uuid4())

    book_entries = _df_to_book_entries(clean_df)
    as26_entries = _df_to_as26_entries(as26_slice)

    # Sort 26AS ascending by amount (small first — can't over-consume large books)
    as26_entries.sort(key=lambda x: x.amount)

    # ── FY segregation (Brief §3/#1) ──────────────────────────────────────
    # When ALLOW_CROSS_FY=False: split pool into current-FY and prior-FY.
    # Phases A/B/C only see current_books. Prior books are Phase E only.
    # Entries with no doc_date (sap_fy="") are treated as current-FY
    # (don't lose matching candidates just because date is unparseable).
    if not ALLOW_CROSS_FY and target_fy:
        current_books = [
            b for b in book_entries
            if b.sap_fy == target_fy or b.sap_fy == ""
        ]
        prior_books = [
            b for b in book_entries
            if b.sap_fy != "" and b.sap_fy != target_fy
        ]
        logger.info(
            "FY control [ALLOW_CROSS_FY=False]: %d current-FY books | %d prior-FY held for Phase E",
            len(current_books), len(prior_books),
        )
    else:
        current_books = book_entries
        prior_books = []
        if ALLOW_CROSS_FY:
            logger.warning(
                "ALLOW_CROSS_FY=True: prior-FY invoices included in main pool — "
                "ensure CA has approved cross-FY matching for this engagement"
            )

    used_book_indices: Set[int] = set()
    # consumed_invoice_refs: prevents the same invoice backing two matches (Brief §3/#2)
    consumed_invoice_refs: Set[str] = set()
    used_clearing_docs: Set[str] = set()
    matched_pairs: List[MatchedPair] = []
    constraint_violations = 0

    # ── Phase A: Clearing Group Matching (3% cap, ≤ MAX_COMBO_SIZE) ───────
    clearing_groups = _build_clearing_groups(current_books)
    phase_a_remaining: List[As26Entry] = []

    for as26 in as26_entries:
        result = _try_clearing_group_match(
            as26, clearing_groups, used_book_indices, used_clearing_docs, consumed_invoice_refs,
        )
        if result is not None:
            books, match_type, var_pct = result
            books_sum = sum(b.amount for b in books)
            if books_sum > as26.amount + EXACT_TOLERANCE:
                constraint_violations += 1
                phase_a_remaining.append(as26)
                continue
            for b in books:
                if b.clearing_doc:
                    used_clearing_docs.add(b.clearing_doc)
            _commit(books, used_book_indices, consumed_invoice_refs)
            matched_pairs.append(_build_matched_pair(as26, books, match_type, target_fy))
        else:
            phase_a_remaining.append(as26)

    phase_a_count = len(matched_pairs)
    logger.info(
        "Phase A (Clearing Groups): %d/%d matched | %d eligible groups",
        phase_a_count, len(as26_entries), len(clearing_groups),
    )

    # ── Phase B: Individual Invoice Matching (tier-specific caps) ─────────
    phase_b_unmatched: List[As26Entry] = []

    for as26 in phase_a_remaining:
        result = _try_individual_match(as26, current_books, used_book_indices, consumed_invoice_refs)
        if result is not None:
            books, match_type, var_pct = result
            books_sum = sum(b.amount for b in books)
            if books_sum > as26.amount + EXACT_TOLERANCE:
                constraint_violations += 1
                phase_b_unmatched.append(as26)
                continue
            _commit(books, used_book_indices, consumed_invoice_refs)
            matched_pairs.append(_build_matched_pair(as26, books, match_type, target_fy))
        else:
            phase_b_unmatched.append(as26)

    phase_b_count = len(matched_pairs) - phase_a_count
    logger.info(
        "Phase B (Individual): %d more matched | %d remaining",
        phase_b_count, len(phase_b_unmatched),
    )

    # ── Phase C: Restricted Force-Match ───────────────────────────────────
    # FORCE_SINGLE ≤5%, FORCE_COMBO ≤2% (2–3 inv only). Anything above → Phase E/D.
    phase_c_remaining = sorted(phase_b_unmatched, key=lambda x: x.amount)
    phase_c_unmatched: List[As26Entry] = []
    phase_c_count = 0

    for as26 in phase_c_remaining:
        result = _try_force_match(as26, current_books, used_book_indices, consumed_invoice_refs)
        if result is not None:
            books, match_type, var_pct = result
            books_sum = sum(b.amount for b in books)
            if books_sum > as26.amount + EXACT_TOLERANCE:
                constraint_violations += 1
                phase_c_unmatched.append(as26)
                continue
            _commit(books, used_book_indices, consumed_invoice_refs)
            matched_pairs.append(_build_matched_pair(as26, books, match_type, target_fy))
            phase_c_count += 1
        else:
            phase_c_unmatched.append(as26)

    logger.info(
        "Phase C (Force-Match): %d matched | %d to Phase E/D",
        phase_c_count, len(phase_c_unmatched),
    )

    # ── Phase E: Prior-Year Exception (Brief §3/#1) ────────────────────────
    # Only runs when ALLOW_CROSS_FY=False and prior-FY books exist.
    # Uses Phase B matching logic (same tight variance ceilings) against
    # prior-FY books. Matches are tagged PRIOR_{match_type} and cross_fy=True.
    # Confidence is always LOW — CA must review before signing.
    phase_e_count = 0
    if prior_books and phase_c_unmatched:
        phase_e_remaining = sorted(phase_c_unmatched, key=lambda x: x.amount)
        phase_e_unmatched: List[As26Entry] = []

        for as26 in phase_e_remaining:
            result = _try_individual_match(
                as26, prior_books, used_book_indices, consumed_invoice_refs,
            )
            if result is not None:
                books, match_type, var_pct = result
                books_sum = sum(b.amount for b in books)
                if books_sum > as26.amount + EXACT_TOLERANCE:
                    constraint_violations += 1
                    phase_e_unmatched.append(as26)
                    continue
                _commit(books, used_book_indices, consumed_invoice_refs)
                # PRIOR_ prefix makes prior-year exceptions unmistakable in output
                matched_pairs.append(
                    _build_matched_pair(as26, books, f"PRIOR_{match_type}", target_fy)
                )
                phase_e_count += 1
            else:
                phase_e_unmatched.append(as26)

        phase_c_unmatched = phase_e_unmatched
        logger.info(
            "Phase E (Prior-Year Exception): %d matched | %d truly unmatched",
            phase_e_count, len(phase_c_unmatched),
        )
    elif not prior_books and not ALLOW_CROSS_FY and target_fy:
        logger.info("Phase E: no prior-FY books in pool — nothing to try")

    # ── Phase D: Classify truly unmatched ─────────────────────────────────
    # Uses full book_entries (both FYs) for diagnostics so reason codes reflect
    # what was loaded vs what was consumed.
    unmatched_26as: List[UnmatchedAs26Entry] = []
    for as26 in phase_c_unmatched:
        ref, amt, var, reason = _classify_unmatched(
            as26, book_entries, used_book_indices, consumed_invoice_refs,
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

    unmatched_books = [b for b in book_entries if b.index not in used_book_indices]

    # ── Post-run compliance validation (Brief §6) ─────────────────────────
    # These assertions catch any bugs that slipped through the per-phase guards.

    # 1. Invoice uniqueness: no invoice_ref appears in more than one match
    all_invoice_refs = [r for p in matched_pairs for r in p.invoice_refs if r]
    if len(all_invoice_refs) != len(set(all_invoice_refs)):
        dupes = [r for r, cnt in Counter(all_invoice_refs).items() if cnt > 1]
        logger.error(
            "POST-RUN BREACH: Invoice reuse in output! Duplicate refs: %s", dupes
        )
        constraint_violations += len(dupes)
    else:
        logger.info("Post-run: invoice uniqueness OK (%d distinct refs)", len(set(all_invoice_refs)))

    # 2. books_sum ≤ 26AS for every match
    overshoot = [p for p in matched_pairs if p.books_sum > p.as26_amount + EXACT_TOLERANCE]
    if overshoot:
        logger.error("POST-RUN BREACH: books_sum > as26_amount in %d rows", len(overshoot))
        constraint_violations += len(overshoot)

    # 3. No match exceeds MAX_COMBO_SIZE
    oversized = [p for p in matched_pairs if p.invoice_count > MAX_COMBO_SIZE]
    if oversized:
        logger.error(
            "POST-RUN BREACH: invoice_count > MAX_COMBO_SIZE=%d in %d rows",
            MAX_COMBO_SIZE, len(oversized),
        )
        constraint_violations += len(oversized)

    # 4. FY boundary: ALLOW_CROSS_FY=False means non-PRIOR_ matches must be current-FY
    if not ALLOW_CROSS_FY and target_fy:
        silent_cross = [
            p for p in matched_pairs
            if p.cross_fy and not p.match_type.startswith("PRIOR_")
        ]
        if silent_cross:
            logger.error(
                "POST-RUN BREACH: %d matches contain prior-FY invoices without PRIOR_ tag",
                len(silent_cross),
            )
            constraint_violations += len(silent_cross)

    # ── Summary stats ─────────────────────────────────────────────────────
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
        "HIGH=%d MEDIUM=%d LOW=%d | cross_fy=%d | prior_year=%d | "
        "unmatched_26as=%d | unmatched_books=%d",
        matched_count, total_26as, match_rate,
        avg_variance, constraint_violations,
        high_conf, med_conf, low_conf, cross_fy, phase_e_count,
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
