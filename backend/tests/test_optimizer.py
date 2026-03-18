"""
Optimizer / matching engine tests — covers all phases + compliance assertions.
"""
import pytest
from engine.optimizer import (
    run_global_optimizer, BookEntry, As26Entry,
    _variance_pct, _confidence,
)


def _book(idx, amount, inv_ref="", clearing_doc="", fy="FY2023-24", doc_date="15-Jun-2023"):
    return BookEntry(
        index=idx, invoice_ref=inv_ref or f"INV-{idx:04d}",
        amount=amount, doc_date=doc_date, doc_type="RV",
        clearing_doc=clearing_doc, sap_fy=fy,
    )


def _as26(idx, amount, section="194C", date="20-Jun-2023"):
    return As26Entry(
        index=idx, amount=amount, transaction_date=date,
        section=section, tan="BLRM12345A", deductor_name="TEST CO",
    )


# ── Basic matching ─────────────────────────────────────────────────────────────

def test_exact_match():
    as26 = [_as26(0, 100000.0)]
    books = [_book(0, 100000.0, "INV-001")]
    matched, unmatched = run_global_optimizer(as26, books, books, [])
    assert len(matched) == 1
    assert len(unmatched) == 0
    assert matched[0].match_type in ("EXACT", "SINGLE", "CLR_GROUP_1")


def test_no_match_above_ceiling():
    as26 = [_as26(0, 100000.0)]
    books = [_book(0, 50000.0)]   # 50% variance — no ceiling covers this
    matched, unmatched = run_global_optimizer(as26, books, books, [])
    assert len(unmatched) == 1


def test_single_match_within_2pct():
    as26 = [_as26(0, 100000.0)]
    books = [_book(0, 98500.0)]   # 1.5% variance
    matched, unmatched = run_global_optimizer(as26, books, books, [])
    assert len(matched) == 1
    assert matched[0].variance_pct == pytest.approx(1.5, abs=0.1)


# ── Compliance: books_sum ≤ as26_amount ───────────────────────────────────────

def test_books_sum_never_exceeds_as26():
    as26 = [_as26(0, 100000.0)]
    books = [_book(0, 100001.0)]  # slightly over — must NOT match
    matched, unmatched = run_global_optimizer(as26, books, books, [])
    for r in matched:
        assert sum(b.amount for b in r.books) <= r.as26_amount + 0.02


# ── Compliance: invoice reuse ─────────────────────────────────────────────────

def test_invoice_not_reused():
    as26 = [_as26(0, 100000.0), _as26(1, 100000.0)]
    books = [_book(0, 100000.0, "INV-SHARED")]  # one book, two 26AS entries
    matched, unmatched = run_global_optimizer(as26, books, books, [])
    # Only one can be matched
    total_matched = len(matched)
    assert total_matched <= 1
    all_refs = [ref for r in matched for b in r.books for ref in [b.invoice_ref]]
    assert len(all_refs) == len(set(all_refs))  # no duplicates


# ── Multiple 26AS vs multiple books ──────────────────────────────────────────

def test_multiple_entries_independent():
    as26 = [_as26(0, 50000.0), _as26(1, 80000.0)]
    books = [_book(0, 50000.0, "INV-001"), _book(1, 80000.0, "INV-002")]
    matched, unmatched = run_global_optimizer(as26, books, books, [])
    assert len(matched) == 2
    assert len(unmatched) == 0


# ── Cross-FY segregation ──────────────────────────────────────────────────────

def test_prior_fy_not_matched_in_phase_b(monkeypatch):
    """Prior-FY books should only appear in Phase E matches, tagged PRIOR_*."""
    as26 = [_as26(0, 100000.0)]
    current = [_book(0, 100000.0, "INV-CURR", fy="FY2023-24")]
    prior = [_book(1, 100000.0, "INV-PRIOR", fy="FY2022-23")]

    matched, unmatched = run_global_optimizer(
        as26, current + prior, current, prior, allow_cross_fy=False
    )
    assert len(matched) == 1
    # Current-FY book should win
    assert not matched[0].is_prior_year


# ── Confidence tiers ──────────────────────────────────────────────────────────

def test_confidence_exact_high():
    assert _confidence(0.0, "EXACT") == "HIGH"


def test_confidence_force_always_low():
    assert _confidence(0.5, "FORCE_SINGLE") == "LOW"
    assert _confidence(0.0, "FORCE_COMBO") == "LOW"


def test_confidence_prior_year_low():
    assert _confidence(0.5, "PRIOR_SINGLE") == "LOW"


def test_confidence_medium_range():
    assert _confidence(2.0, "SINGLE") == "MEDIUM"


# ── Variance helper ───────────────────────────────────────────────────────────

def test_variance_pct_exact():
    assert _variance_pct(100000.0, 100000.0) == pytest.approx(0.0)


def test_variance_pct_1pct():
    assert _variance_pct(100000.0, 99000.0) == pytest.approx(1.0)


def test_variance_pct_zero_as26():
    assert _variance_pct(0.0, 100.0) == 100.0
