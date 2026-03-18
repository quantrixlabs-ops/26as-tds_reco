"""
Validation engine tests — covers all 6 pre-match validators.
Run with: pytest backend/tests/ -v
"""
import pytest
import pandas as pd
from engine.validator import (
    validate_26as, compute_control_totals, ValidationReport,
    KNOWN_SECTIONS, STANDARD_RATES,
)


def _make_df(**kwargs) -> pd.DataFrame:
    """Helper: build a minimal valid 26AS row as DataFrame."""
    base = {
        "tan": "BLRM12345A",
        "deductor_name": "TEST COMPANY LTD",
        "section": "194C",
        "transaction_date": "15-Jun-2023",
        "amount": 100000.0,
        "tds_amount": 1000.0,   # 1% of 100000
        "status": "F",
    }
    base.update(kwargs)
    return pd.DataFrame([base])


# ── 1. Valid row passes ───────────────────────────────────────────────────────

def test_valid_row_passes():
    df, report = validate_26as(_make_df())
    assert report.total_rows == 1
    assert report.valid_rows == 1
    assert report.rejected_rows == 0
    assert not report.has_blocking_errors
    assert report.issues == []


# ── 2. Null amount rejected ───────────────────────────────────────────────────

def test_null_amount_rejected():
    df, report = validate_26as(_make_df(amount=None))
    assert report.rejected_rows == 1
    assert any(i.code == "NULL_AMOUNT" for i in report.issues)


# ── 3. Negative amount flagged (not rejected) ─────────────────────────────────

def test_negative_amount_flagged():
    df, report = validate_26as(_make_df(amount=-5000.0))
    # Negative: flagged as REVERSAL, not rejected (valid=True for now, just flagged)
    assert any(i.code == "NEGATIVE_AMOUNT" for i in report.issues)
    reversal_rows = df[df["_flags"].str.contains("REVERSAL", na=False)]
    assert len(reversal_rows) > 0


# ── 4. Unknown section flagged ────────────────────────────────────────────────

def test_unknown_section_flagged():
    df, report = validate_26as(_make_df(section="999XX"))
    assert report.section_issues == 1
    assert any(i.code == "UNKNOWN_SECTION" for i in report.issues)


# ── 5. Known sections pass ────────────────────────────────────────────────────

@pytest.mark.parametrize("section", ["194C", "194J", "194I", "195", "192A"])
def test_known_sections_pass(section):
    df, report = validate_26as(_make_df(section=section, tds_amount=None))  # skip rate check
    section_issues = [i for i in report.issues if i.code == "UNKNOWN_SECTION"]
    assert len(section_issues) == 0


# ── 6. TDS rate validation ────────────────────────────────────────────────────

def test_rate_mismatch_flagged():
    # 194C rate = 1%. TDS=10000 on gross=100000 implies 10% — mismatch
    df, report = validate_26as(_make_df(section="194C", amount=100000.0, tds_amount=10000.0))
    assert report.rate_mismatches == 1
    rate_issue = next((i for i in report.issues if i.code in ("RATE_MISMATCH", "POSSIBLE_206AA")), None)
    assert rate_issue is not None


def test_correct_rate_passes():
    # 194C rate = 1%. TDS=1000 on gross=100000 → exact match
    df, report = validate_26as(_make_df(section="194C", amount=100000.0, tds_amount=1000.0))
    assert report.rate_mismatches == 0


def test_206aa_detected():
    # 20% rate → 206AA
    df, report = validate_26as(_make_df(section="194C", amount=100000.0, tds_amount=20000.0))
    assert report.pan_issues > 0
    assert any(i.code == "POSSIBLE_206AA" for i in report.issues)


# ── 7. Duplicate detection ────────────────────────────────────────────────────

def test_duplicate_26as_detected():
    row = {
        "tan": "BLRM12345A", "deductor_name": "TEST",
        "section": "194C", "transaction_date": "15-Jun-2023",
        "amount": 100000.0, "tds_amount": 1000.0, "status": "F",
    }
    df = pd.DataFrame([row, row])  # exact duplicate
    _, report = validate_26as(df)
    assert report.duplicates_found == 1
    assert any(i.code == "DUPLICATE_26AS" for i in report.issues)


def test_different_rows_not_duplicates():
    rows = [
        {"tan": "BLRM12345A", "deductor_name": "TEST", "section": "194C",
         "transaction_date": "15-Jun-2023", "amount": 100000.0, "tds_amount": 1000.0, "status": "F"},
        {"tan": "BLRM12345A", "deductor_name": "TEST", "section": "194C",
         "transaction_date": "20-Jul-2023", "amount": 200000.0, "tds_amount": 2000.0, "status": "F"},
    ]
    df = pd.DataFrame(rows)
    _, report = validate_26as(df)
    assert report.duplicates_found == 0


# ── 8. Control totals ─────────────────────────────────────────────────────────

def test_control_totals_balanced():
    result = compute_control_totals(
        total_26as_amount=1_000_000.0,
        matched_amount=900_000.0,
        unmatched_26as_amount=100_000.0,
    )
    assert result["balanced"] is True
    assert result["difference"] < 0.02


def test_control_totals_unbalanced():
    result = compute_control_totals(
        total_26as_amount=1_000_000.0,
        matched_amount=800_000.0,
        unmatched_26as_amount=100_000.0,   # missing 100k
    )
    assert result["balanced"] is False
    assert result["difference"] > 0


# ── 9. Empty DataFrame ────────────────────────────────────────────────────────

def test_empty_dataframe():
    df = pd.DataFrame()
    validated, report = validate_26as(df)
    assert report.total_rows == 0
    assert report.valid_rows == 0
