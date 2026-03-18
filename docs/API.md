# REST API Reference

**Base URL (local):** `http://localhost:8000`
**Framework:** FastAPI 0.115
**Auth:** None (no authentication in v1.0.0 — see KNOWN_GAPS.md)

All request/response bodies are JSON unless the endpoint handles file upload (multipart/form-data) or file download (binary stream).

---

## Health

### `GET /api/health`

Check if the server is running.

**Response `200`**
```json
{
  "status": "ok",
  "version": "1.0.0"
}
```

---

## Financial Years

### `GET /api/financial-years`

Returns the list of supported financial years and the default.

**Response `200`**
```json
{
  "years": ["FY2020-21", "FY2021-22", "FY2022-23", "FY2023-24", "FY2024-25", "FY2025-26"],
  "default": "FY2023-24"
}
```

---

## Single-Party Reconciliation

### `POST /api/reconcile`

Upload one SAP AR Ledger file and one 26AS file. Runs the full 5-phase reconciliation engine.

**Request** — `multipart/form-data`

| Field | Type | Required | Description |
|---|---|---|---|
| `sap_file` | `.xlsx` file | Yes | SAP AR Ledger export |
| `as26_file` | `.xlsx` file | Yes | Form 26AS from TRACES portal |
| `financial_year` | string | No | e.g., `"FY2023-24"` (defaults to `FY2023-24`) |

**Response `200` — Auto-confirmed alignment**
```json
{
  "status": "done",
  "session_id": "abc123",
  "result": {
    "deductor_name": "MICRONOVA TECHNOLOGIES PVT LTD",
    "tan": "BLRM12345A",
    "matched_count": 142,
    "total_26as_entries": 148,
    "unmatched_26as_count": 6,
    "unmatched_books_count": 23,
    "match_rate_pct": 95.9,
    "high_confidence_count": 98,
    "medium_confidence_count": 38,
    "low_confidence_count": 6,
    "cross_fy_match_count": 0,
    "constraint_violations": 0,
    "avg_variance_pct": 0.82,
    "matched_pairs": [...],
    "unmatched_26as": [...],
    "unmatched_books": [...]
  },
  "cleaning_report": {
    "total_rows_input": 9624,
    "rows_after_cleaning": 4201,
    "excluded_null": 0,
    "excluded_negative": 312,
    "excluded_noise": 4,
    "excluded_doc_type": 5107,
    "excluded_sgl": 0,
    "excluded_date_fy": 0,
    "flagged_advance": 0,
    "flagged_ab": 0,
    "flagged_other_sgl": 0,
    "duplicates_removed": 0,
    "split_invoices_flagged": 0,
    "used_fallback_doc_types": false
  },
  "alignment": {
    "status": "AUTO_CONFIRMED",
    "score": 97,
    "deductor_name": "MICRONOVA TECHNOLOGIES PVT LTD",
    "tan": "BLRM12345A",
    "candidates": []
  }
}
```

**Response `200` — Alignment needs confirmation**
```json
{
  "status": "pending_alignment",
  "session_id": "abc123",
  "alignment": {
    "status": "PENDING",
    "score": 85,
    "deductor_name": "MICRONOVA TECH",
    "tan": "BLRM12345A",
    "candidates": [
      {"name": "MICRONOVA TECHNOLOGIES PVT LTD", "tan": "BLRM12345A", "score": 85},
      {"name": "MICRONOVA SYSTEMS LTD", "tan": "BLRM99999B", "score": 81}
    ]
  }
}
```
When this response is received, the user must confirm the correct deductor via `POST /api/confirm-alignment`.

**Alignment status values:**

| Status | Meaning |
|---|---|
| `AUTO_CONFIRMED` | Score ≥ 95 and second candidate < 80 — no user action needed |
| `PENDING` | Score 80–94 — user must confirm |
| `NO_MATCH` | Score < 80 — user must search manually |

---

### `POST /api/confirm-alignment`

Confirm or override the deductor name alignment after a `pending_alignment` response.

**Request body**
```json
{
  "session_id": "abc123",
  "confirmed_name": "MICRONOVA TECHNOLOGIES PVT LTD",
  "confirmed_tan": "BLRM12345A"
}
```

**Response `200`** — Same structure as `/api/reconcile` with `"status": "done"`

---

### `GET /api/search-deductor`

Search 26AS deductor names manually (for `NO_MATCH` cases).

**Query parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `session_id` | string | Yes | Session from initial reconcile call |
| `query` | string | Yes | Search string (partial name, TAN, etc.) |

**Response `200`**
```json
[
  {"name": "MICRONOVA TECHNOLOGIES PVT LTD", "tan": "BLRM12345A", "score": 91},
  {"name": "MICRONOVA SYSTEMS LTD", "tan": "BLRM99999B", "score": 78}
]
```

---

### `GET /api/download/{session_id}`

Download the Excel output for a completed single-party reconciliation.

**Path parameter:** `session_id` — from the reconcile response

**Response `200`** — Binary `.xlsx` file stream

```
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename="TDS_Reco_MICRONOVA_FY2023-24.xlsx"
```

**Response `404`** — Session expired or not found

---

## Batch Reconciliation

### `POST /api/batch/upload`

Upload multiple SAP files and one 26AS file. Returns auto-mapped party assignments for review before running.

**Request** — `multipart/form-data`

| Field | Type | Required | Description |
|---|---|---|---|
| `sap_files` | Multiple `.xlsx` files | Yes | One file per deductor/party |
| `as26_file` | `.xlsx` file | Yes | Combined 26AS (all parties) |
| `financial_year` | string | No | e.g., `"FY2023-24"` |

**Response `200`**
```json
{
  "batch_id": "batch_xyz789",
  "financial_year": "FY2023-24",
  "mappings": [
    {
      "sap_filename": "MICRONOVA_TECH_SAP.xlsx",
      "identity": "MICRONOVA TECH",
      "status": "AUTO_CONFIRMED",
      "score": 97,
      "matched_deductor": "MICRONOVA TECHNOLOGIES PVT LTD",
      "matched_tan": "BLRM12345A",
      "candidates": []
    },
    {
      "sap_filename": "ABC_CORP_SAP.xlsx",
      "identity": "ABC CORP",
      "status": "PENDING",
      "score": 83,
      "matched_deductor": "ABC CORPORATION LTD",
      "matched_tan": "MUMB98765Z",
      "candidates": [
        {"name": "ABC CORPORATION LTD", "tan": "MUMB98765Z", "score": 83},
        {"name": "ABC INDIA PVT LTD", "tan": "MUMB11111A", "score": 80}
      ]
    }
  ]
}
```

---

### `POST /api/batch/confirm`

Confirm the party-to-deductor mappings and run all reconciliations.

**Request body**
```json
{
  "batch_id": "batch_xyz789",
  "confirmations": [
    {
      "sap_filename": "MICRONOVA_TECH_SAP.xlsx",
      "confirmed_name": "MICRONOVA TECHNOLOGIES PVT LTD",
      "confirmed_tan": "BLRM12345A"
    },
    {
      "sap_filename": "ABC_CORP_SAP.xlsx",
      "confirmed_name": "ABC CORPORATION LTD",
      "confirmed_tan": "MUMB98765Z"
    }
  ]
}
```

**Response `200`**
```json
{
  "batch_id": "batch_xyz789",
  "financial_year": "FY2023-24",
  "parties": [
    {
      "sap_filename": "MICRONOVA_TECH_SAP.xlsx",
      "deductor_name": "MICRONOVA TECHNOLOGIES PVT LTD",
      "tan": "BLRM12345A",
      "matched_count": 142,
      "total_26as_entries": 148,
      "match_rate_pct": 95.9,
      "high_confidence_count": 98,
      "medium_confidence_count": 38,
      "low_confidence_count": 6,
      "constraint_violations": 0
    },
    {
      "sap_filename": "ABC_CORP_SAP.xlsx",
      "deductor_name": "ABC CORPORATION LTD",
      "tan": "MUMB98765Z",
      "matched_count": 31,
      "total_26as_entries": 35,
      "match_rate_pct": 88.6,
      "high_confidence_count": 24,
      "medium_confidence_count": 7,
      "low_confidence_count": 0,
      "constraint_violations": 0
    }
  ]
}
```

---

### `GET /api/batch/download/{batch_id}`

Download the combined Excel workbook for all parties in the batch.

**Path parameter:** `batch_id` — from batch upload response

**Response `200`** — Binary `.xlsx` file stream

```
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename="Batch_TDS_Reco_FY2023-24.xlsx"
```

Workbook structure:
- Sheet 1: `Master Summary` (one row per party, aggregate totals)
- Per party: `{Name}_Match`, `{Name}_Un26AS`, `{Name}_UnBks`, `{Name}_Var`

**Response `404`** — Batch session expired or not found

---

### `GET /api/batch/parties`

Get the party-level summary for a completed batch run.

**Query parameter:** `batch_id`

**Response `200`** — Same `parties` array as in `POST /api/batch/confirm` response

---

## Data Models

### MatchedPair
```json
{
  "as26_amount": 125000.00,
  "as26_date": "15-Jun-2023",
  "section": "194C",
  "books_sum": 124800.00,
  "variance_amt": 200.00,
  "variance_pct": 0.16,
  "confidence": "HIGH",
  "match_type": "SINGLE",
  "invoice_refs": ["INV-2023-04512"],
  "invoice_amounts": [124800.00],
  "invoice_dates": ["10-Jun-2023"],
  "clearing_doc": "1500012345",
  "cross_fy": false
}
```

### UnmatchedAs26Entry
```json
{
  "deductor_name": "MICRONOVA TECHNOLOGIES PVT LTD",
  "tan": "BLRM12345A",
  "transaction_date": "20-Sep-2023",
  "amount": 85000.00,
  "section": "194J",
  "reason": "[U02] Closest match 12.3% variance — exceeds all ceilings"
}
```

### CleaningReport
```json
{
  "total_rows_input": 9624,
  "rows_after_cleaning": 4201,
  "excluded_null": 0,
  "excluded_negative": 312,
  "excluded_noise": 4,
  "excluded_doc_type": 5107,
  "excluded_sgl": 0,
  "excluded_date_fy": 0,
  "flagged_advance": 0,
  "flagged_ab": 0,
  "flagged_other_sgl": 0,
  "duplicates_removed": 0,
  "split_invoices_flagged": 0,
  "used_fallback_doc_types": false
}
```

---

## Error Responses

All errors follow FastAPI's standard format:

```json
{
  "detail": "Error message describing what went wrong"
}
```

| Status Code | Condition |
|---|---|
| `400` | Invalid file format, missing required field, parse error |
| `404` | Session or batch ID not found (expired or never created) |
| `422` | Request validation error (wrong field types, missing body) |
| `500` | Internal server error (algorithm assertion failure, unexpected exception) |

---

## Session Management

- Sessions are stored in-memory (Python dict)
- TTL: 30 minutes (`SESSION_TTL_SECONDS = 1800`)
- On server restart: all sessions are lost
- The downloaded Excel file is the only persistent output
- No session persistence to disk in v1.0.0
