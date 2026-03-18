# Reconciliation Algorithm — v5 Reference

**Engine file:** `backend/reco_engine.py`
**Config file:** `backend/config.py`
**Implemented:** March 2026 (Change Request Brief)

---

## Overview

The engine matches each Form 26AS entry (a government-reported TDS credit) against one or more SAP AR Ledger entries (internal invoice records) to verify that the company's recorded receivables align with the TDS credits available for claim under Section 199.

The algorithm is **greedy sequential**: 26AS entries are processed one at a time in ascending amount order. Book entries consumed in one match are unavailable to subsequent matches. This means results are **not globally optimal** — processing order affects which matches are found.

---

## Pre-Processing

Before the engine runs, two cleaning pipelines execute:

### SAP Cleaning (`cleaner.py`)
1. Load `.xlsx` using openpyxl (read-only, data-only)
2. Row filters (rows failing any gate are excluded):
   - Amount is null → excluded
   - Amount ≤ 0 → excluded (negative amounts and zeros)
   - Amount < `NOISE_THRESHOLD` (₹1.0) → excluded as noise
   - Doc Type in `{CC, BR}` → excluded
   - Special G/L Indicator in `{L, E, U}` → excluded
   - Doc Date outside SAP date window → excluded (current FY + `SAP_LOOKBACK_YEARS` prior FYs)
3. Doc Type priority:
   - If any `{RV, DC, DR}` rows exist → use only those (primary pool)
   - Otherwise → use all remaining rows, tagged `FALLBACK_DOCTYPE`
4. Special G/L flags: `V→SGL_V` (advance), `O→SGL_O`, `A→SGL_A`, `N→SGL_N`
5. Deduplication by `(invoice_ref, clearing_doc)`:
   - Same invoice + same clearing doc + same amount → true duplicate, keep one
   - Same invoice + same clearing doc + different amounts → `SPLIT_INVOICE` flag, keep all
   - Same invoice + different clearing docs → separate payment events, keep all
6. `sap_fy` label computed per row (e.g., `FY2023-24`) from `doc_date`

**Output:** `clean_df` DataFrame with columns: `doc_date`, `amount`, `invoice_ref`, `doc_type`, `sgl_ind`, `flag`, `clearing_doc`, `sap_fy`

### 26AS Parsing (`parser_26as.py`)
1. Header auto-detected within first 5 rows
2. Only `Status = "F"` (Final) rows processed
3. Amount column: `"Amount Paid/Credited"` (gross, not TDS deducted)
4. Sheets named "tanwise" or "summary" ignored for main data
5. Section code (194C, 194J, etc.) parsed and stored but not used in matching logic

---

## FY Segregation

When `ALLOW_CROSS_FY = False` (default):
- SAP books are split into two pools before matching begins:
  - `current_books` — entries where `sap_fy == target_fy`
  - `prior_books` — all other entries within the SAP date window
- Phases A, B, C use only `current_books`
- Phase E uses only `prior_books` (for entries still unmatched after Phase C)

When `ALLOW_CROSS_FY = True`:
- Both pools are merged and treated equally in all phases

---

## 26AS Entry Order

All 26AS entries are sorted **ascending by amount** before processing:
```python
as26_entries.sort(key=lambda x: x.amount)
```
Rationale: smaller entries consume fewer books, leaving large-denomination books available for large entries. This is a heuristic, not an optimal strategy. Running in descending or random order will produce different results.

---

## Phase A — Clearing Group Matching (CLR_GROUP)

**Purpose:** Match 26AS entries to groups of SAP invoices that were settled together in one payment run (same clearing document number).

**How it works:**
1. Build clearing groups: group SAP book entries by `clearing_doc` value
2. Skip groups where `clearing_doc` is empty or `"0"`
3. Skip groups where `len(group) > MAX_COMBO_SIZE` (5) — these are large payment runs that would produce unverifiable combo matches; they are excluded entirely
4. For each 26AS entry, find clearing groups where:
   - All entries in the group are available (not yet consumed)
   - No entry's `invoice_ref` is in `consumed_invoice_refs`
   - `group_sum ≤ as26_amount + EXACT_TOLERANCE`
5. Select the group with minimum variance within `VARIANCE_CAP_CLR_GROUP` (3%)
6. Commit: mark all group entries as used; add all `invoice_ref` values to `consumed_invoice_refs`

**Match type:** `CLR_GROUP`
**Confidence:** determined by variance (HIGH if ≤1%, MEDIUM if 1–3%)

---

## Phase B — Individual Entry Matching

**Purpose:** Match each remaining 26AS entry to one or more SAP invoices using exact and tolerance-based matching.

### Available Books Filter
For each 26AS entry, the available pool is:
```
available = [
    b for b in book_pool
    if b.index not in used_book_indices        # not consumed
    and b.amount <= as26.amount + EXACT_TOLERANCE  # cannot exceed 26AS amount
    and (not b.invoice_ref or b.invoice_ref not in consumed_invoice_refs)
]
```

### Matching Sequence (within Phase B, per 26AS entry)

**Step 1 — Exact match (size 1)**
- Find single book entry where `|book_amount - as26_amount| ≤ EXACT_TOLERANCE` (₹0.01)
- Match type: `EXACT`

**Step 2 — SINGLE match (size 1, with tolerance)**
- Find single book entry where variance ≤ `VARIANCE_CAP_SINGLE` (2.0%)
- Match type: `SINGLE`

**Step 3 — COMBO_2 (size 2)**
- `itertools.combinations(available, 2)`
- Per-size budget: stop after `COMBO_LIMIT` (500) combinations tried
- Accept if `combo_sum ≤ as26_amount` and variance ≤ `VARIANCE_CAP_SINGLE` (2%)
  - Note: COMBO_2 uses SINGLE cap, not COMBO cap — two-invoice combos require higher precision
- Match type: `COMBO_2`

**Step 4 — COMBO_3 / COMBO_4 / COMBO_5 (sizes 3–5)**
- Same as COMBO_2 but variance cap = `VARIANCE_CAP_COMBO` (3.0%)
- Match types: `COMBO_3`, `COMBO_4`, `COMBO_5`
- Each size has its own `COMBO_LIMIT` budget (not shared)

**First valid match wins** — the algorithm stops at the earliest match found and does not evaluate whether a later match would have lower variance.

---

## Phase C — Restricted Force-Match

**Purpose:** Last resort for entries still unmatched after Phase B. Uses relaxed variance ceilings but with hard restrictions to prevent abuse.

### FORCE_SINGLE
- Single SAP entry with variance ≤ `VARIANCE_CAP_FORCE_SINGLE` (5.0%)
- Hard constraint: `books_sum ≤ as26_amount` still enforced
- Match type: `FORCE_SINGLE`
- Confidence: `LOW` (always)

### FORCE_COMBO
- Combinations of 2–3 invoices only (`FORCE_COMBO_MAX_INVOICES = 3`)
- Variance ≤ `FORCE_COMBO_MAX_VARIANCE` (2.0%)
- Hard constraint: `books_sum ≤ as26_amount`
- Match type: `FORCE_COMBO`
- Confidence: `LOW` (always)

Phase C returns `None` if no match found — it does not accumulate or greedy-extend.

---

## Phase E — Prior-Year Exception

**Purpose:** Handle legitimate cross-FY scenarios (e.g., invoices raised in FY2022-23 where TDS credit appears in FY2023-24 26AS).

**Active only when `ALLOW_CROSS_FY = False`** (default). Skipped when `ALLOW_CROSS_FY = True` (prior books already in the main pool).

**How it works:**
1. Takes entries still unmatched after Phase C
2. Runs Phase B logic (Exact → SINGLE → COMBO) against `prior_books` pool
3. All successful matches tagged `PRIOR_YEAR_EXCEPTION`
4. Confidence: `LOW` (always — requires explicit CA review)

---

## Phase D — Truly Unmatched

All entries that reach this phase receive an `UnmatchedAs26Entry` record with one of:

| Code | Condition |
|---|---|
| `U01` | Best available SAP invoice covers < 50% of 26AS amount (too large a gap) |
| `U02` | Closest match found but variance exceeded all ceilings |
| `U04` | Only prior-year invoices available and `ALLOW_CROSS_FY = False` |

---

## Post-Run Compliance Validation

After all phases complete, four hard assertions are checked:

1. **Invoice uniqueness** — No `invoice_ref` appears in more than one matched pair's `invoice_refs` list
2. **Books ≤ 26AS** — For every matched pair, `books_sum ≤ as26_amount + EXACT_TOLERANCE`
3. **Combo cap** — No matched pair uses more than `MAX_COMBO_SIZE` invoices
4. **FY boundary** — When `ALLOW_CROSS_FY = False`, no non-PRIOR_YEAR match uses a prior-FY book entry

Any assertion failure raises `RuntimeError` and halts the run. The output is not produced until all four pass.

---

## Confidence Assignment

```python
def _confidence(variance_pct: float, match_type: str) -> str:
    if "FORCE" in match_type or "PRIOR" in match_type:
        return "LOW"
    if variance_pct <= 1.0:
        return "HIGH"
    return "MEDIUM"
```

---

## Section 199 Compliance Guarantee

The following invariants are enforced throughout all phases:

1. `books_sum ≤ as26_amount` — a taxpayer cannot claim more TDS credit than what is shown in 26AS
2. Each SAP invoice reference backs at most one 26AS match — prevents double-claiming one payment
3. FORCE_ and PRIOR_ matches are always flagged LOW confidence — CA must explicitly review

These are the minimum necessary conditions for a reconciliation to support a Section 199 TDS credit claim. They are necessary but not sufficient — the CA must also verify section alignment and commercial plausibility.

---

## Algorithm Limitations

| Limitation | Impact |
|---|---|
| Greedy sequential, not globally optimal | Different input ordering → different results |
| No TDS section filter in match logic | 194C entries can match against 194J invoices |
| No invoice date proximity scoring | Temporally implausible matches are accepted if amounts align |
| Combo search is purely mathematical | Unrelated invoices that sum correctly will be matched |
| Phase A clearing groups skip size > 5 | Large payment runs remain unmatched (conservative but lossy) |
| COMBO_LIMIT budget may miss better matches | If the best combo is found after 500 tries, it's missed |

---

## Parameters Quick Reference

| Constant | Value | Affects |
|---|---|---|
| `MAX_COMBO_SIZE` | 5 | All phases |
| `COMBO_LIMIT` | 500 | Phase B per size level |
| `EXACT_TOLERANCE` | ₹0.01 | EXACT match threshold |
| `VARIANCE_CAP_SINGLE` | 2.0% | SINGLE and COMBO_2 |
| `VARIANCE_CAP_COMBO` | 3.0% | COMBO_3/4/5 |
| `VARIANCE_CAP_CLR_GROUP` | 3.0% | Phase A CLR_GROUP |
| `VARIANCE_CAP_FORCE_SINGLE` | 5.0% | Phase C FORCE_SINGLE |
| `FORCE_COMBO_MAX_INVOICES` | 3 | Phase C FORCE_COMBO size cap |
| `FORCE_COMBO_MAX_VARIANCE` | 2.0% | Phase C FORCE_COMBO variance cap |
| `ALLOW_CROSS_FY` | False | FY segregation |
| `SAP_LOOKBACK_YEARS` | 1 | SAP date window |
