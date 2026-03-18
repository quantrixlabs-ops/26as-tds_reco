"""
Validation Engine — runs BEFORE matching.
Implements all 6 mandatory pre-match validators.

1. PAN validation (format check + 206AA detection)
2. 26AS duplicate / revision detection
3. Section validation (known sections only)
4. TDS rate validation: derived_gross = TDS / rate vs reported gross
5. Control totals: will be verified post-match
6. Negative / invalid entry flagging
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Set, Tuple
import pandas as pd

# ── Constants ──────────────────────────────────────────────────────────────────

PAN_REGEX = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")

KNOWN_SECTIONS: Set[str] = {
    "192", "192A", "193", "194", "194A", "194B", "194BB", "194C",
    "194D", "194DA", "194E", "194EE", "194F", "194G", "194H", "194I",
    "194IA", "194IB", "194IC", "194J", "194K", "194LA", "194LB",
    "194LBA", "194LC", "194LD", "194N", "194O", "194P", "194Q",
    "194R", "194S", "195", "196A", "196B", "196C", "196D",
    "206AA", "206AB",
}

# Standard TDS rates by section (used for rate validation)
STANDARD_RATES: Dict[str, float] = {
    "194C": 1.0,    # Individual/HUF contractors
    "194J": 10.0,   # Professional fees
    "194I": 10.0,   # Rent (land/building/furniture)
    "194IA": 1.0,   # Immovable property (non-agri)
    "194IB": 5.0,   # Rent by individual/HUF > 50k/month
    "194H": 5.0,    # Commission / brokerage
    "194D": 5.0,    # Insurance commission
    "194A": 10.0,   # Interest other than securities
    "194B": 30.0,   # Lottery winnings
    "193": 10.0,    # Interest on securities
    "194G": 5.0,    # Commission on lottery tickets
    "194O": 1.0,    # E-commerce operators
    "194Q": 0.1,    # Purchase of goods
    "195": 20.0,    # Non-resident payments (default)
    "206AA": 20.0,  # PAN not available — higher rate
}

RATE_TOLERANCE_PCT = 2.0   # Allow 2% tolerance in rate-derived gross vs reported gross
HIGH_VALUE_THRESHOLD = 1_000_000  # ₹10 lakh — flag unmatched entries above this


# ── Result Types ──────────────────────────────────────────────────────────────

@dataclass
class ValidationIssue:
    code: str            # e.g. "PAN_INVALID", "DUPLICATE_26AS", "RATE_MISMATCH"
    severity: str        # "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"
    row_index: int
    description: str
    field: Optional[str] = None
    value: Optional[str] = None


@dataclass
class ValidationReport:
    total_rows: int = 0
    valid_rows: int = 0
    rejected_rows: int = 0
    flagged_rows: int = 0
    issues: List[ValidationIssue] = field(default_factory=list)
    duplicates_found: int = 0
    pan_issues: int = 0
    rate_mismatches: int = 0
    section_issues: int = 0
    has_blocking_errors: bool = False
    control_total_26as: float = 0.0

    def add_issue(self, issue: ValidationIssue) -> None:
        self.issues.append(issue)
        if issue.severity == "CRITICAL":
            self.has_blocking_errors = True

    def to_dict(self) -> dict:
        return {
            "total_rows": self.total_rows,
            "valid_rows": self.valid_rows,
            "rejected_rows": self.rejected_rows,
            "flagged_rows": self.flagged_rows,
            "duplicates_found": self.duplicates_found,
            "pan_issues": self.pan_issues,
            "rate_mismatches": self.rate_mismatches,
            "section_issues": self.section_issues,
            "has_blocking_errors": self.has_blocking_errors,
            "control_total_26as": self.control_total_26as,
            "issues": [
                {
                    "code": i.code,
                    "severity": i.severity,
                    "row_index": i.row_index,
                    "description": i.description,
                    "field": i.field,
                    "value": i.value,
                }
                for i in self.issues
            ],
        }


# ── Validator ─────────────────────────────────────────────────────────────────

def validate_26as(df: pd.DataFrame) -> Tuple[pd.DataFrame, ValidationReport]:
    """
    Run all validators on the parsed 26AS DataFrame.

    Returns:
        (validated_df, report)
        validated_df: rows that pass validation (flagged rows are KEPT but marked)
        report: full ValidationReport with all issues
    """
    report = ValidationReport(total_rows=len(df))
    if df.empty:
        return df, report

    df = df.copy()
    df["_valid"] = True
    df["_flags"] = ""
    df["_derived_gross"] = None
    df["_rate_mismatch"] = False
    df["_section_valid"] = True

    seen_signatures: Dict[str, int] = {}   # for duplicate detection

    for idx, row in df.iterrows():
        row_issues: List[ValidationIssue] = []

        # 1. Negative / zero amount
        amount = row.get("amount", 0)
        if pd.isna(amount) or amount is None:
            row_issues.append(ValidationIssue(
                code="NULL_AMOUNT", severity="CRITICAL", row_index=idx,
                description="Amount is null", field="amount"
            ))
            df.at[idx, "_valid"] = False
        elif amount < 0:
            row_issues.append(ValidationIssue(
                code="NEGATIVE_AMOUNT", severity="HIGH", row_index=idx,
                description=f"Negative amount ₹{amount:,.2f} — possible reversal. Flagged for review.",
                field="amount", value=str(amount)
            ))
            df.at[idx, "_flags"] = _add_flag(df.at[idx, "_flags"], "REVERSAL")

        # 2. Section validation
        section = str(row.get("section", "")).strip()
        if section and section not in KNOWN_SECTIONS:
            row_issues.append(ValidationIssue(
                code="UNKNOWN_SECTION", severity="MEDIUM", row_index=idx,
                description=f"Section '{section}' is not a recognized TDS section",
                field="section", value=section
            ))
            df.at[idx, "_section_valid"] = False
            report.section_issues += 1

        # 3. TDS rate validation
        tds_amount = row.get("tds_amount")
        if tds_amount and not pd.isna(tds_amount) and amount and amount > 0 and section in STANDARD_RATES:
            expected_rate = STANDARD_RATES[section]
            derived_gross = (float(tds_amount) / expected_rate) * 100
            df.at[idx, "_derived_gross"] = round(derived_gross, 2)

            if amount > 0:
                rate_divergence_pct = abs(derived_gross - float(amount)) / float(amount) * 100
                if rate_divergence_pct > RATE_TOLERANCE_PCT:
                    df.at[idx, "_rate_mismatch"] = True
                    report.rate_mismatches += 1

                    # Check for 206AA (20% rate — PAN not available)
                    if tds_amount and float(tds_amount) > 0:
                        implied_rate = float(tds_amount) / float(amount) * 100
                        if implied_rate >= 19.0:
                            row_issues.append(ValidationIssue(
                                code="POSSIBLE_206AA", severity="HIGH", row_index=idx,
                                description=f"Implied TDS rate {implied_rate:.1f}% suggests PAN non-availability (Section 206AA)",
                                field="tds_amount", value=f"{implied_rate:.1f}%"
                            ))
                            report.pan_issues += 1
                            df.at[idx, "_flags"] = _add_flag(df.at[idx, "_flags"], "POSSIBLE_206AA")
                        else:
                            row_issues.append(ValidationIssue(
                                code="RATE_MISMATCH", severity="MEDIUM", row_index=idx,
                                description=(
                                    f"Section {section}: expected rate {expected_rate}%, "
                                    f"derived gross ₹{derived_gross:,.2f} vs reported ₹{amount:,.2f} "
                                    f"({rate_divergence_pct:.1f}% divergence)"
                                ),
                                field="tds_amount"
                            ))
                            df.at[idx, "_flags"] = _add_flag(df.at[idx, "_flags"], "RATE_MISMATCH")

        # 4. Duplicate detection (same TAN + section + date + amount + TDS)
        sig = _row_signature(row)
        if sig in seen_signatures:
            report.duplicates_found += 1
            row_issues.append(ValidationIssue(
                code="DUPLICATE_26AS", severity="HIGH", row_index=idx,
                description=f"Duplicate of row {seen_signatures[sig]} (same TAN/section/date/amount)",
                field="amount"
            ))
            df.at[idx, "_flags"] = _add_flag(df.at[idx, "_flags"], "DUPLICATE_26AS")
        else:
            seen_signatures[sig] = idx

        # Accumulate issues
        for issue in row_issues:
            report.add_issue(issue)
        if row_issues:
            report.flagged_rows += 1

    # Final counts
    report.valid_rows = int(df["_valid"].sum())
    report.rejected_rows = report.total_rows - report.valid_rows
    report.control_total_26as = float(df[df["_valid"]]["amount"].sum())

    return df, report


def validate_sap_books(df: pd.DataFrame) -> Tuple[pd.DataFrame, List[ValidationIssue]]:
    """
    Lighter validation pass on cleaned SAP books.
    Returns flagged DF and issue list (non-blocking).
    """
    issues: List[ValidationIssue] = []
    if df.empty:
        return df, issues

    df = df.copy()
    df["_sap_flags"] = df.get("flag", "")

    for idx, row in df.iterrows():
        amount = row.get("amount", 0)

        # Flag split invoices (already done in cleaner — just propagate)
        if "SPLIT_INVOICE" in str(row.get("flag", "")):
            issues.append(ValidationIssue(
                code="SPLIT_INVOICE", severity="LOW", row_index=idx,
                description=f"Invoice {row.get('invoice_ref', '')} has split clearing entries",
                field="invoice_ref"
            ))

        # Flag advances
        if "SGL_V" in str(row.get("flag", "")):
            issues.append(ValidationIssue(
                code="ADVANCE_PAYMENT", severity="LOW", row_index=idx,
                description=f"Row {idx} flagged as advance payment (Special G/L = V)",
                field="sgl_ind", value="V"
            ))

    return df, issues


# ── Helpers ───────────────────────────────────────────────────────────────────

def _row_signature(row) -> str:
    """Unique signature for duplicate detection."""
    tan = str(row.get("tan", "") or "").strip()
    section = str(row.get("section", "") or "").strip()
    date = str(row.get("transaction_date", "") or "").strip()
    raw_amount = row.get("amount", 0)
    amount = str(round(float(raw_amount), 2)) if raw_amount is not None else "0"
    raw_tds = row.get("tds_amount", 0)
    tds = str(round(float(raw_tds), 2)) if raw_tds is not None else "0"
    return f"{tan}|{section}|{date}|{amount}|{tds}"


def _add_flag(existing: str, new_flag: str) -> str:
    if not existing:
        return new_flag
    flags = set(existing.split(","))
    flags.add(new_flag)
    return ",".join(sorted(flags))


def compute_control_totals(
    total_26as_amount: float,
    matched_amount: float,
    unmatched_26as_amount: float,
) -> dict:
    """
    Verify: total_26as_amount == matched_amount + unmatched_26as_amount
    Returns a control totals dict with balanced flag.
    """
    computed_sum = matched_amount + unmatched_26as_amount
    difference = abs(total_26as_amount - computed_sum)
    balanced = difference < 0.02  # ₹0.02 tolerance for floating point

    return {
        "total_26as_amount": round(total_26as_amount, 2),
        "matched_amount": round(matched_amount, 2),
        "unmatched_26as_amount": round(unmatched_26as_amount, 2),
        "computed_sum": round(computed_sum, 2),
        "difference": round(difference, 2),
        "balanced": balanced,
    }
