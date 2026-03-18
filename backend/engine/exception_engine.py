"""
Exception Engine — automatically generates REQUIRES REVIEW records.

Produces ExceptionRecord entries for:
1. FORCE matches (FORCE_SINGLE, FORCE_COMBO)
2. HIGH_VARIANCE (variance > 3%)
3. CROSS_FY / PRIOR_YEAR matches
4. SECTION_MISMATCH (if section data available)
5. RATE_MISMATCH (from validation report)
6. PAN_ISSUE (206AA indicators)
7. DUPLICATE_26AS (from validation report)
8. AI_RISK_FLAG (from AI assist layer)
9. UNMATCHED_HIGH_VALUE (unmatched entries > ₹10L)
"""
from __future__ import annotations

from typing import List, Optional
from engine.optimizer import AssignmentResult, As26Entry
from engine.validator import ValidationReport, HIGH_VALUE_THRESHOLD


def generate_exceptions(
    matched: List[AssignmentResult],
    unmatched_26as: List[As26Entry],
    validation_report: ValidationReport,
    run_id: str,
) -> List[dict]:
    """
    Generate exception records for database insertion.
    Returns list of dicts matching ExceptionRecord fields.
    """
    exceptions: List[dict] = []

    # ── From matched pairs ────────────────────────────────────────────────────
    for result in matched:
        # 1. FORCE matches
        if "FORCE" in result.match_type:
            exceptions.append(_exc(
                run_id=run_id,
                exception_type="FORCE_MATCH",
                severity="HIGH",
                description=(
                    f"{result.match_type}: {len(result.books)} invoice(s), "
                    f"variance {result.variance_pct:.2f}%. "
                    f"Score: {result.score.total:.1f}/100. "
                    f"Section: {result.as26_section}. "
                    f"Amount: ₹{result.as26_amount:,.2f}"
                ),
                amount=result.as26_amount,
                section=result.as26_section,
            ))

        # 2. HIGH_VARIANCE (>3% but not FORCE)
        elif result.variance_pct > 3.0 and "FORCE" not in result.match_type:
            exceptions.append(_exc(
                run_id=run_id,
                exception_type="HIGH_VARIANCE",
                severity="MEDIUM",
                description=(
                    f"Variance {result.variance_pct:.2f}% on {result.match_type} match. "
                    f"26AS amount ₹{result.as26_amount:,.2f}, "
                    f"books sum ₹{sum(b.amount for b in result.books):,.2f}"
                ),
                amount=result.as26_amount,
                section=result.as26_section,
            ))

        # 3. PRIOR_YEAR / CROSS_FY
        if result.is_prior_year or result.cross_fy:
            exceptions.append(_exc(
                run_id=run_id,
                exception_type="CROSS_FY",
                severity="HIGH",
                description=(
                    f"Prior-year match ({result.match_type}): "
                    f"26AS amount ₹{result.as26_amount:,.2f}. "
                    f"Invoice date(s): {[b.doc_date for b in result.books]}. "
                    f"Invoice FY: {result.books[0].sap_fy if result.books else 'unknown'}"
                ),
                amount=result.as26_amount,
                section=result.as26_section,
            ))

        # 4. AI risk flag
        if result.ai_risk_flag:
            exceptions.append(_exc(
                run_id=run_id,
                exception_type="AI_RISK_FLAG",
                severity="MEDIUM",
                description=f"AI flagged: {result.ai_risk_reason or 'Anomaly detected'}",
                amount=result.as26_amount,
                section=result.as26_section,
            ))

    # ── From unmatched 26AS ───────────────────────────────────────────────────
    for entry in unmatched_26as:
        if entry.amount >= HIGH_VALUE_THRESHOLD:
            exceptions.append(_exc(
                run_id=run_id,
                exception_type="UNMATCHED_HIGH_VALUE",
                severity="CRITICAL",
                description=(
                    f"High-value 26AS entry unmatched: ₹{entry.amount:,.2f}. "
                    f"Section: {entry.section}. TAN: {entry.tan}. "
                    f"Date: {entry.transaction_date}"
                ),
                amount=entry.amount,
                section=entry.section,
            ))

    # ── From validation report ─────────────────────────────────────────────────
    for issue in validation_report.issues:
        if issue.code == "RATE_MISMATCH":
            exceptions.append(_exc(
                run_id=run_id,
                exception_type="RATE_MISMATCH",
                severity="MEDIUM",
                description=issue.description,
                amount=None,
                section=None,
            ))
        elif issue.code == "POSSIBLE_206AA":
            exceptions.append(_exc(
                run_id=run_id,
                exception_type="PAN_ISSUE",
                severity="HIGH",
                description=issue.description,
                amount=None,
                section=None,
            ))
        elif issue.code == "DUPLICATE_26AS":
            exceptions.append(_exc(
                run_id=run_id,
                exception_type="DUPLICATE_26AS",
                severity="HIGH",
                description=issue.description,
                amount=None,
                section=None,
            ))

    return exceptions


def _exc(
    run_id: str,
    exception_type: str,
    severity: str,
    description: str,
    amount: Optional[float],
    section: Optional[str],
) -> dict:
    return {
        "run_id": run_id,
        "exception_type": exception_type,
        "severity": severity,
        "description": description,
        "amount": amount,
        "section": section,
        "reviewed": False,
    }
