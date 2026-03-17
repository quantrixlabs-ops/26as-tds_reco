"""
SAP AR Ledger Cleaning Pipeline — Phase 1
Pure function: clean_sap_books(file_bytes, fy_start, fy_end) → (clean_df, CleaningReport)

Doc Type Filter (v2): PRIMARY = RV and DR only.
  If zero RV/DR rows exist after all other filters, fall back to all non-noise positives
  so the user always sees something meaningful rather than an empty result.

Column reference (0-based positional index — NEVER use header name detection):
  col[5]  Document Type        ← GATE 1
  col[6]  Document Date        ← DATE field + FY date-range filter
  col[8]  Special G/L ind.     ← GATE 2
  col[10] Amount in local currency  ← AMOUNT
  col[14] Invoice reference    ← REF
"""
from __future__ import annotations

import io
import logging
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple

import openpyxl
import pandas as pd

from config import NOISE_THRESHOLD
from models import CleaningReport

logger = logging.getLogger(__name__)

# ── Document Type Rules (v2) ──────────────────────────────────────────────────
# RV = Revenue billing, DC = Customer invoice (alt SAP config), DR = Debit memo
# All three are valid TDS-bearing invoice types. CC/BR always excluded.
PRIMARY_DOC_TYPES  = {"RV", "DC", "DR"}  # Primary: all three invoice types
EXCLUDE_DOC_TYPES  = {"CC", "BR"}        # Always excluded — reversals / bank receipts

# ── Special G/L Indicator Rules ───────────────────────────────────────────────
EXCLUDE_SGL = {"L", "E", "U"}
FLAG_SGL = {
    "V": "SGL_V",
    "O": "SGL_O",
    "A": "SGL_A",
    "N": "SGL_N",
}


@dataclass
class _ExclusionCounters:
    null: int = 0
    negative: int = 0
    noise: int = 0
    doc_type: int = 0
    sgl: int = 0
    date_out_of_fy: int = 0
    dupe: int = 0
    flagged_advance: int = 0
    flagged_other_sgl: int = 0
    split_invoices: int = 0


def _parse_raw_date(val: Any) -> Optional[date]:
    """Return a date object (no time) from an openpyxl cell value, or None."""
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    try:
        return pd.to_datetime(str(val), dayfirst=True).date()
    except Exception:
        return None


def _fmt_date(val: Any) -> Optional[str]:
    """Format cell value as DD-MMM-YYYY string."""
    d = _parse_raw_date(val)
    return d.strftime("%d-%b-%Y") if d else (str(val) if val else None)


def _build_clean_df(
    raw_rows: List[Dict],
    c: _ExclusionCounters,
) -> pd.DataFrame:
    """Deduplicate and return final clean DataFrame."""
    df = pd.DataFrame(raw_rows)
    if df.empty:
        return df

    final_rows: List[Dict] = []
    for ref, group in df.groupby("invoice_ref"):
        if ref == "":
            for _, r in group.iterrows():
                final_rows.append(r.to_dict())
            continue
        unique_amounts = group["amount"].unique()
        if len(unique_amounts) == 1:
            c.dupe += len(group) - 1
            final_rows.append(group.iloc[0].to_dict())
        else:
            c.split_invoices += 1
            for _, r in group.iterrows():
                rd = r.to_dict()
                ef = rd.get("flag", "")
                rd["flag"] = f"{ef},SPLIT_INVOICE".strip(",") if ef else "SPLIT_INVOICE"
                final_rows.append(rd)

    return pd.DataFrame(final_rows).reset_index(drop=True)


def clean_sap_books(
    file_bytes: bytes,
    noise_threshold: float = NOISE_THRESHOLD,
    fy_start: Optional[date] = None,
    fy_end: Optional[date] = None,
) -> Tuple[pd.DataFrame, CleaningReport]:
    """
    Parse and clean a raw SAP AR ledger Excel file.

    Parameters
    ----------
    file_bytes      : Raw .xlsx bytes
    noise_threshold : Rows below this amount are excluded as noise
    fy_start        : If provided, exclude rows with doc_date < fy_start
    fy_end          : If provided, exclude rows with doc_date > fy_end

    Returns
    -------
    clean_df        : DataFrame [doc_date, amount, invoice_ref, doc_type, sgl_ind, flag]
    cleaning_report : CleaningReport
    """
    wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True, read_only=True)
    ws = wb.active

    c = _ExclusionCounters()
    primary_rows: List[Dict] = []   # RV + DR rows
    fallback_rows: List[Dict] = []  # all other valid non-excluded rows
    total_input = 0

    for row in ws.iter_rows(min_row=2, values_only=True):
        total_input += 1

        # ── Step 2: Null amount ────────────────────────────────────────────
        raw_amount = row[10]
        if raw_amount is None:
            c.null += 1
            continue
        try:
            amount = float(raw_amount)
        except (ValueError, TypeError):
            c.null += 1
            continue

        # ── Step 3: Non-positive ───────────────────────────────────────────
        if amount <= 0:
            c.negative += 1
            continue

        # ── Step 4: Noise filter ───────────────────────────────────────────
        if amount < noise_threshold:
            c.noise += 1
            continue

        # ── Step 5a: Document Type gate ────────────────────────────────────
        doc_type = str(row[5]).strip() if row[5] is not None else ""
        if doc_type in EXCLUDE_DOC_TYPES:
            c.doc_type += 1
            continue
        # Unknown/other types are allowed in fallback but not primary
        is_primary = doc_type in PRIMARY_DOC_TYPES

        # ── Step 5b: FY date-range filter ──────────────────────────────────
        doc_date_raw = row[6]
        doc_date = _parse_raw_date(doc_date_raw)
        if fy_start and fy_end and doc_date is not None:
            if not (fy_start <= doc_date <= fy_end):
                c.date_out_of_fy += 1
                continue
        # If doc_date is None and FY filter is active, still include
        # (can't filter what we can't parse — surface it for review)

        # ── Step 6: Special G/L Indicator gate ────────────────────────────
        sgl = str(row[8]).strip() if row[8] is not None else ""
        flag = ""

        if sgl in EXCLUDE_SGL:
            c.sgl += 1
            continue
        elif sgl in FLAG_SGL:
            flag = FLAG_SGL[sgl]
            if sgl == "V":
                c.flagged_advance += 1
            else:
                c.flagged_other_sgl += 1

        # ── Collect ────────────────────────────────────────────────────────
        record = {
            "doc_date":    _fmt_date(doc_date_raw),
            "amount":      amount,
            "invoice_ref": str(row[14]).strip() if row[14] is not None else "",
            "doc_type":    doc_type,
            "sgl_ind":     sgl,
            "flag":        flag,
        }
        if is_primary:
            primary_rows.append(record)
        else:
            fallback_rows.append(record)

    wb.close()

    # ── Choose primary vs fallback ─────────────────────────────────────────
    # Use primary (RV+DR) if any exist; otherwise fall back to all valid rows
    # so the user always sees a result rather than an empty reco.
    used_fallback = False
    if primary_rows:
        rows_to_use = primary_rows
        # Non-primary rows that were excluded go into doc_type counter
        c.doc_type += len(fallback_rows)
    else:
        rows_to_use = fallback_rows
        used_fallback = True
        logger.warning(
            "No RV/DR rows found after filtering — falling back to all %d valid rows",
            len(fallback_rows),
        )

    clean_df = _build_clean_df(rows_to_use, c)

    if used_fallback and not clean_df.empty:
        # Mark all fallback rows so auditor knows primary types were absent
        clean_df["flag"] = clean_df["flag"].apply(
            lambda f: f"{f},FALLBACK_DOCTYPE".strip(",") if f else "FALLBACK_DOCTYPE"
        )

    report = CleaningReport(
        total_rows_input=total_input,
        rows_after_cleaning=len(clean_df),
        excluded_null=c.null,
        excluded_negative=c.negative,
        excluded_noise=c.noise,
        excluded_doc_type=c.doc_type,
        excluded_sgl=c.sgl,
        excluded_date_fy=c.date_out_of_fy,
        flagged_advance=c.flagged_advance,
        flagged_ab=0,               # AB no longer included as primary
        flagged_other_sgl=c.flagged_other_sgl,
        duplicates_removed=c.dupe,
        split_invoices_flagged=c.split_invoices,
        used_fallback_doc_types=used_fallback,
    )

    logger.info(
        "SAP cleaning: %d raw → %d clean | "
        "excluded: null=%d neg=%d noise=%d doctype=%d sgl=%d fy=%d dupes=%d | fallback=%s",
        total_input, len(clean_df),
        c.null, c.negative, c.noise, c.doc_type, c.sgl, c.date_out_of_fy, c.dupe,
        used_fallback,
    )
    return clean_df, report
