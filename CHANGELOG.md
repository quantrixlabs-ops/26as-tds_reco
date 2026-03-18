# Changelog

All notable changes to 26AS Matcher are documented here.
Format: [Semantic Versioning](https://semver.org/) — MAJOR.MINOR.PATCH

---

## [1.0.0] — 2026-03-18

### First tagged release — working-paper tool, requires CA review

This release implements the full Change Request Brief (CRB, March 2026) issued after CA benchmarking of the original algorithm on FY2023-24 data (9,624 SAP rows, 4,648 26AS entries).

---

### Added

**Algorithm v5 — Reconciliation Engine (`reco_engine.py`)**
- Phase A: Clearing Group matching — groups SAP entries by clearing document; skips groups > `MAX_COMBO_SIZE` entirely (no partial clearing)
- Phase B: Individual matching — Exact → SINGLE → COMBO_2 → COMBO_3/4/5 per 26AS entry; combo budget is per-size (500 per level), not a shared global counter
- Phase C: Restricted Force-Match — FORCE_SINGLE (≤5% variance) and FORCE_COMBO (max 3 invoices, ≤2% variance) only; returns `None` if no match found, no greedy accumulation
- Phase E: Prior-Year Exception — tries prior-FY SAP books for entries still unmatched after Phase C; tags all results `PRIOR_YEAR_EXCEPTION` with LOW confidence; only active when `ALLOW_CROSS_FY=False`
- Phase D: Truly Unmatched — all remaining entries with reason codes U01/U02/U04
- Post-run compliance validation: 4 hard assertions (invoice uniqueness, `books_sum ≤ as26_amount`, combo cap, FY boundary)
- `consumed_invoice_refs` set — hard guard preventing the same SAP invoice from backing two 26AS matches (Section 199 compliance)
- `_confidence()` function — HIGH (≤1% variance, non-FORCE), MEDIUM (1–5%, non-FORCE), LOW (any FORCE or PRIOR_YEAR match)

**Config overhaul (`config.py`)**
- Tier-specific variance ceilings: `VARIANCE_CAP_SINGLE=2.0`, `VARIANCE_CAP_COMBO=3.0`, `VARIANCE_CAP_CLR_GROUP=3.0`, `VARIANCE_CAP_FORCE_SINGLE=5.0`
- FORCE_COMBO controls: `FORCE_COMBO_MAX_INVOICES=3`, `FORCE_COMBO_MAX_VARIANCE=2.0`
- Cross-FY control: `ALLOW_CROSS_FY=False` (default)
- `MAX_COMBO_SIZE=5` (reduced from 8) enforced across all phases
- `COMBO_LIMIT=500` per size level
- `SAP_LOOKBACK_YEARS=1` — loads current FY + 1 prior FY into SAP pool
- Helper functions: `fy_date_range()`, `sap_date_window()`, `date_to_fy_label()`

**Batch Mode**
- `batch_engine.py` — auto-maps multiple SAP files to 26AS deductors by fuzzy name (rapidfuzz token_sort_ratio); returns mapping with confidence scores; runs all reconciliations sequentially
- `batch_excel.py` — generates combined workbook: Master Summary sheet (one row per party, aggregate totals) + per-party `{Name}_Match`, `{Name}_Un26AS`, `{Name}_UnBks`, `{Name}_Var` sheets; Excel-safe sheet naming (31-char limit, deduplication)
- API endpoints: `POST /api/batch/upload`, `POST /api/batch/confirm`, `GET /api/batch/download/{batch_id}`, `GET /api/batch/parties`
- Frontend pages: `BatchUploadPage`, `BatchMappingPage`, `BatchResultsPage`

**Documentation**
- `README.md` — full project documentation
- `CHANGELOG.md` — this file
- `docs/ALGORITHM.md` — 5-phase engine deep-dive
- `docs/API.md` — REST API reference
- `docs/KNOWN_GAPS.md` — honest gap register (31 items)
- `VERSION` file — current version string

---

### Fixed

**`cleaner.py` — Deduplication logic overhaul**
- Previously: deduplicated on `invoice_ref` alone — incorrectly dropped valid payment events where the same invoice had been settled in multiple separate payment runs (different clearing documents)
- Fixed: deduplication now uses `(invoice_ref, clearing_doc)` pair
  - Same invoice + same clearing doc + same amount → true duplicate, remove extras
  - Same invoice + same clearing doc + different amounts → `SPLIT_INVOICE` flag, keep all rows
  - Same invoice + different clearing docs → separate payment events, keep all rows

**`excel_generator.py` — Import fix**
- `from config import VARIANCE_CAP_PCT` → `from config import VARIANCE_CAP_FORCE_SINGLE as VARIANCE_CAP_PCT`
- Was causing `ImportError` on server start after `config.py` was rewritten with tier-specific constants

**`batch_excel.py` — Same import fix**
- Same `ImportError` fix applied

---

### Changed

**SAP Cleaning (`cleaner.py`)**
- Primary doc types: `RV`, `DC`, `DR` (DC was previously removed, now restored)
- Fallback behaviour: if no primary doc type rows exist, uses all valid rows and tags them `FALLBACK_DOCTYPE`
- `SPLIT_INVOICE` flag added for partial clearing scenarios
- `sap_fy` field computed and carried through for each book row (used by Phase E to segregate prior-year entries)

**Algorithm behaviour (vs pre-CRB version)**
- Cross-FY matches: previously ~41.5% of matches used prior-FY books with no segregation; now prior-FY books are only tried in Phase E and always tagged LOW confidence
- Invoice reuse: previously the same invoice could back multiple 26AS matches; now blocked by `consumed_invoice_refs`
- Combo size: previously up to 8 invoices; now capped at 5 in all phases
- FORCE_COMBO: previously unbounded greedy accumulation (produced matches of 529 invoices); now restricted to 3 invoices and 2% variance ceiling
- Variance ceilings: previously one global cap; now per-tier

---

### Known Gaps at v1.0.0

See [docs/KNOWN_GAPS.md](docs/KNOWN_GAPS.md) for the full register. Summary:

| Risk | Item |
|---|---|
| Blocking | CRB deployment gate not yet cleared (benchmark validation pending) |
| High | No user authentication or access control |
| High | No input file integrity hashing (no tamper evidence) |
| High | Sessions expire after 30 min — no persistent audit trail |
| High | Algorithm version not stamped on output Excel |
| High | No PAN capture or 206AA detection |
| High | Amount control totals not balanced in output |
| Medium | No TDS section segregation in matching (194C/194J share pool) |
| Medium | No invoice date proximity scoring |
| Medium | Global matching is greedy, not optimal |
| Medium | No stress testing beyond one dataset |
| Low | No match type distribution report (EXACT/SINGLE/COMBO/FORCE breakdown) |

---

## [Unreleased]

Planned improvements (not yet scheduled):
- Algorithm version stamp on output Excel header
- Amount-level control totals in Master Summary
- Match type breakdown (EXACT/SINGLE/COMBO/FORCE) in summary sheet
- Input file SHA-256 checksum stored in output
- TDS section filter in matching logic
- Invoice date proximity scoring
- User authentication (basic API key)
- Persistent audit log to disk
- Test suite (unit tests for reco_engine, cleaner, parser)
- Stress testing at 50k+ invoice scale
