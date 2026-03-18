"""
Batch Multi-Party Reconciliation Engine
Orchestrates auto-mapping of SAP files to 26AS deductors and batch reco execution.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
from rapidfuzz import fuzz

from aligner import extract_identity_string
from cleaner import clean_sap_books
from config import (
    AUTO_CONFIRM_SCORE,
    FUZZY_THRESHOLD,
    DEFAULT_FINANCIAL_YEAR,
    fy_date_range,
    sap_date_window,
    fy_label_from_date_range,
)
from excel_generator import generate_excel
from batch_excel import generate_batch_excel
from models import (
    CleaningReport,
    PartyMapping,
    PartyRecoSummary,
    RecoResult,
)
from reco_engine import run_reco

logger = logging.getLogger(__name__)

# Lower threshold for batch: be more generous with auto-matching
BATCH_AUTO_THRESHOLD = 75  # Auto-confirm at 75%+ in batch mode


# ── Auto-mapping ──────────────────────────────────────────────────────────────

def _get_unique_parties(as26_df: pd.DataFrame) -> List[Dict[str, Any]]:
    """Extract unique (deductor_name, tan) pairs with entry counts from 26AS."""
    if as26_df.empty:
        return []
    parties = []
    for (name, tan), grp in as26_df.groupby(["deductor_name", "tan"]):
        parties.append({
            "deductor_name": str(name).strip(),
            "tan": str(tan).strip().upper(),
            "entry_count": len(grp),
        })
    return parties


def get_all_26as_parties(as26_df: pd.DataFrame) -> List[Dict[str, Any]]:
    """Public helper: returns all unique parties from 26AS with entry counts."""
    return _get_unique_parties(as26_df)


def auto_map_sap_to_26as(
    sap_filenames: List[str],
    as26_df: pd.DataFrame,
    tanwise_extras: Optional[List[dict]] = None,
) -> Tuple[List[PartyMapping], List[str], List[dict]]:
    """
    For each SAP filename, fuzzy-match against unique 26AS deductors.

    Mapping strategy:
    - Score ≥ 75%: AUTO (will be processed without user action)
    - Score < 75%: UNMATCHED (user must manually assign)

    Returns:
        mappings:                List of PartyMapping (one per SAP file)
        unmapped_sap_files:      SAP filenames with no good match (score < 75)
        uncovered_26as_parties:  26AS parties not matched by any SAP file
    """
    parties = _get_unique_parties(as26_df)
    # Add tanwise extras
    existing_tans = {p["tan"] for p in parties}
    for extra in (tanwise_extras or []):
        if extra["tan"].upper() not in existing_tans:
            parties.append({
                "deductor_name": extra["deductor_name"],
                "tan": extra["tan"].upper(),
                "entry_count": 0,
            })

    if not parties:
        return [], sap_filenames[:], []

    mappings: List[PartyMapping] = []
    unmapped: List[str] = []

    for sap_fn in sap_filenames:
        identity = extract_identity_string(sap_fn)
        logger.info("Batch auto-map: SAP '%s' → identity '%s'", sap_fn, identity)

        # Score against all parties
        best_score = 0.0
        best_party = None
        for party in parties:
            score = fuzz.token_sort_ratio(identity, party["deductor_name"])
            if score > best_score:
                best_score = score
                best_party = party

        if best_party and best_score >= BATCH_AUTO_THRESHOLD:
            mappings.append(PartyMapping(
                sap_filename=sap_fn,
                deductor_name=best_party["deductor_name"],
                tan=best_party["tan"],
                fuzzy_score=best_score,
                status="AUTO",
            ))
            logger.info(
                "  → AUTO matched to '%s' (%s) score=%.1f%%",
                best_party["deductor_name"], best_party["tan"], best_score,
            )
        else:
            # Low score: still assign best guess but mark as UNMATCHED
            mappings.append(PartyMapping(
                sap_filename=sap_fn,
                deductor_name=best_party["deductor_name"] if best_party else "",
                tan=best_party["tan"] if best_party else "",
                fuzzy_score=best_score,
                status="UNMATCHED",
            ))
            unmapped.append(sap_fn)
            logger.info(
                "  → UNMATCHED (best: '%s' score=%.1f%%)",
                best_party["deductor_name"] if best_party else "none", best_score,
            )

    # Find uncovered 26AS parties (no SAP file mapped to them at all)
    all_mapped_tans = {m.tan for m in mappings}  # Include ALL mappings, not just AUTO
    uncovered = [
        {"deductor_name": p["deductor_name"], "tan": p["tan"], "entry_count": p["entry_count"]}
        for p in parties
        if p["tan"] not in all_mapped_tans and p["entry_count"] > 0
    ]

    # Sort: AUTO first (high score), then UNMATCHED
    mappings.sort(key=lambda m: (-1 if m.status == "AUTO" else 0, -m.fuzzy_score))

    logger.info(
        "Batch auto-map: %d SAP files → %d AUTO, %d UNMATCHED, %d uncovered 26AS parties",
        len(sap_filenames),
        sum(1 for m in mappings if m.status == "AUTO"),
        sum(1 for m in mappings if m.status == "UNMATCHED"),
        len(uncovered),
    )

    return mappings, unmapped, uncovered


# ── Batch Reconciliation ─────────────────────────────────────────────────────

def run_batch_reco(
    batch_id: str,
    confirmed_mappings: List[PartyMapping],
    sap_files_bytes: Dict[str, bytes],
    as26_df: pd.DataFrame,
    clean_dfs: Dict[str, pd.DataFrame],
    cleaning_reports: Dict[str, CleaningReport],
    fy_label: str,
) -> Tuple[List[PartyRecoSummary], bytes]:
    """
    Run reconciliation for each confirmed mapping.
    Processes ALL mappings (AUTO + CONFIRMED).

    Returns:
        summaries:   List of PartyRecoSummary (one per party)
        excel_bytes: Combined Excel workbook bytes
    """
    summaries: List[PartyRecoSummary] = []
    results_for_excel: List[Tuple[RecoResult, CleaningReport, str]] = []

    logger.info(
        "Batch reco starting: %d mappings to process", len(confirmed_mappings),
    )

    for i, mapping in enumerate(confirmed_mappings, 1):
        sap_fn = mapping.sap_filename
        session_id = f"{batch_id}__{mapping.tan}"

        logger.info(
            "Batch reco [%d/%d] %s (%s) ← %s",
            i, len(confirmed_mappings),
            mapping.deductor_name, mapping.tan, sap_fn,
        )

        try:
            # Get cleaned SAP data for this file
            if sap_fn not in clean_dfs:
                logger.warning("No cleaned data for SAP file: %s", sap_fn)
                summaries.append(PartyRecoSummary(
                    deductor_name=mapping.deductor_name,
                    tan=mapping.tan,
                    sap_filename=sap_fn,
                    status="ERROR",
                    error_message=f"No cleaned SAP data for {sap_fn}",
                    session_id=session_id,
                ))
                continue

            clean_df = clean_dfs[sap_fn]
            report = cleaning_reports.get(sap_fn)

            if clean_df.empty:
                summaries.append(PartyRecoSummary(
                    deductor_name=mapping.deductor_name,
                    tan=mapping.tan,
                    sap_filename=sap_fn,
                    status="ERROR",
                    error_message="SAP file has no valid rows after cleaning",
                    session_id=session_id,
                ))
                continue

            # Filter 26AS to this deductor — prefer TAN (exact identifier)
            # then fall back to name match. TAN is definitive; name may vary.
            as26_slice = as26_df[
                as26_df["tan"] == mapping.tan
            ].copy().reset_index(drop=True)

            # If TAN match is empty, try name match as fallback
            if as26_slice.empty and mapping.deductor_name:
                as26_slice = as26_df[
                    as26_df["deductor_name"] == mapping.deductor_name
                ].copy().reset_index(drop=True)

            if as26_slice.empty:
                summaries.append(PartyRecoSummary(
                    deductor_name=mapping.deductor_name,
                    tan=mapping.tan,
                    sap_filename=sap_fn,
                    status="ERROR",
                    error_message="No 26AS entries found for this deductor/TAN",
                    session_id=session_id,
                ))
                continue

            # Run reco
            result = run_reco(
                clean_df=clean_df,
                as26_slice=as26_slice,
                deductor_name=mapping.deductor_name,
                tan=mapping.tan,
                fuzzy_score=mapping.fuzzy_score,
                session_id=session_id,
                target_fy=fy_label,
            )

            if report is None:
                report = CleaningReport(
                    total_rows_input=0, rows_after_cleaning=len(clean_df),
                    excluded_null=0, excluded_negative=0, excluded_noise=0,
                    excluded_doc_type=0, excluded_sgl=0, excluded_date_fy=0,
                    flagged_advance=0, flagged_ab=0, flagged_other_sgl=0,
                    duplicates_removed=0, split_invoices_flagged=0,
                    used_fallback_doc_types=False,
                )

            # Collect for Excel
            results_for_excel.append((result, report, sap_fn))

            summaries.append(PartyRecoSummary(
                deductor_name=result.deductor_name,
                tan=result.tan,
                sap_filename=sap_fn,
                match_rate_pct=result.match_rate_pct,
                total_26as_entries=result.total_26as_entries,
                matched_count=result.matched_count,
                unmatched_26as_count=result.unmatched_26as_count,
                unmatched_books_count=result.unmatched_books_count,
                constraint_violations=result.constraint_violations,
                high_confidence_count=result.high_confidence_count,
                medium_confidence_count=result.medium_confidence_count,
                low_confidence_count=result.low_confidence_count,
                cross_fy_match_count=result.cross_fy_match_count,
                avg_variance_pct=result.avg_variance_pct,
                status="SUCCESS",
                session_id=session_id,
            ))

            logger.info(
                "  → SUCCESS: match_rate=%.1f%% matched=%d/%d",
                result.match_rate_pct, result.matched_count, result.total_26as_entries,
            )

        except Exception as e:
            logger.exception("Batch reco failed for %s: %s", sap_fn, e)
            summaries.append(PartyRecoSummary(
                deductor_name=mapping.deductor_name,
                tan=mapping.tan,
                sap_filename=sap_fn,
                status="ERROR",
                error_message=str(e),
                session_id=session_id,
            ))

    # Generate combined Excel
    excel_bytes = generate_batch_excel(results_for_excel, fy_label)

    logger.info(
        "Batch complete: %d parties, %d success, %d failed, Excel=%d bytes",
        len(confirmed_mappings),
        sum(1 for s in summaries if s.status == "SUCCESS"),
        sum(1 for s in summaries if s.status == "ERROR"),
        len(excel_bytes),
    )

    return summaries, excel_bytes
