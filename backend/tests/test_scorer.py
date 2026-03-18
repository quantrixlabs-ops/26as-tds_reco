"""
Composite scorer tests.
"""
import pytest
from engine.scorer import score_candidate, BookCandidate, _score_variance, _score_date_proximity


def _candidate(amounts, dates=None, clearing_doc=None):
    return BookCandidate(
        invoice_refs=["INV-001"] * len(amounts),
        amounts=amounts,
        dates=dates or [None] * len(amounts),
        clearing_doc=clearing_doc,
        sap_fy="FY2023-24",
    )


# ── Variance scoring ──────────────────────────────────────────────────────────

def test_exact_match_variance():
    assert _score_variance(0.0) == 100.0
    assert _score_variance(0.005) == 100.0  # within 0.01%


def test_variance_decay():
    assert _score_variance(1.0) == pytest.approx(90.0, abs=1)
    assert _score_variance(2.0) == pytest.approx(75.0, abs=1)
    assert _score_variance(3.0) == pytest.approx(55.0, abs=1)
    assert _score_variance(5.0) == pytest.approx(20.0, abs=1)


def test_high_variance_near_zero():
    score = _score_variance(10.0)
    assert score >= 0.0
    assert score < 20.0


# ── Date proximity scoring ────────────────────────────────────────────────────

def test_same_date_max_score():
    score = _score_date_proximity("15-Jun-2023", ["15-Jun-2023"])
    assert score == 100.0


def test_30_day_gap():
    score = _score_date_proximity("15-Jun-2023", ["15-Jul-2023"])
    assert score == pytest.approx(100.0, abs=2)


def test_180_day_gap():
    score = _score_date_proximity("15-Jun-2023", ["15-Dec-2023"])
    assert 0 <= score <= 25  # 183-day gap → score is 5 (far but valid)


def test_no_dates_neutral():
    score = _score_date_proximity(None, [None])
    assert score == 50.0


# ── Composite score ────────────────────────────────────────────────────────────

def test_perfect_match_high_score():
    candidate = _candidate([100000.0], ["15-Jun-2023"], clearing_doc="CLR001")
    score = score_candidate(100000.0, "15-Jun-2023", "194C", candidate)
    assert score.total >= 80.0


def test_exact_amount_clearing_doc_boosts_score():
    with_clr = score_candidate(100000.0, "15-Jun-2023", "194C",
                               _candidate([100000.0], ["15-Jun-2023"], "CLR001"))
    without_clr = score_candidate(100000.0, "15-Jun-2023", "194C",
                                  _candidate([100000.0], ["15-Jun-2023"], None))
    assert with_clr.total > without_clr.total


def test_score_components_sum_to_total():
    candidate = _candidate([95000.0], ["01-Apr-2023"], "CLR999")
    score = score_candidate(100000.0, "15-Jun-2023", "194C", candidate)
    computed = (score.variance_score + score.date_score +
                score.section_score + score.clearing_score + score.historical_score)
    assert abs(score.total - computed) < 0.01


def test_score_bounded_0_to_100():
    candidate = _candidate([1.0], ["01-Jan-2020"])
    score = score_candidate(100000.0, "15-Jun-2023", "194C", candidate)
    assert 0.0 <= score.total <= 100.0
