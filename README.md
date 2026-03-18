# 26AS Matcher — TDS Reconciliation Engine

**Version:** 1.0.0 | **Algorithm:** v5 (CRB March 2026) | **Status:** Working-paper tool — requires CA review before client deliverables

---

## What It Does

26AS Matcher reconciles a company's SAP AR Ledger against the government's Form 26AS to verify TDS credit claims under **Section 199 of the Income Tax Act, 1961**.

It automates the pre-matching work that a CA would otherwise do manually in Excel — identifying which SAP invoices correspond to which 26AS TDS credit entries — and produces a structured Excel workbook with matched pairs, unmatched entries, and variance analysis.

---

## Two Operating Modes

### Single-Party Mode
Upload one SAP AR Ledger file and one 26AS file for one deductor. The system fuzzy-matches the deductor name, runs the reconciliation, and generates a 5-sheet Excel output.

### Batch Mode
Upload multiple SAP files (one per deductor) and one combined 26AS file. The system auto-maps each SAP file to its corresponding 26AS deductor by name, runs all reconciliations, and produces a single combined Excel workbook with a Master Summary sheet and per-party detail sheets.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11, FastAPI 0.115, Uvicorn |
| Data processing | pandas 2.2, openpyxl 3.1, numpy 2.0 |
| Name matching | rapidfuzz 3.10 (token_sort_ratio) |
| Frontend | React 19, TypeScript 5.9, Vite 7, Tailwind CSS 4 |
| Containerisation | Docker + docker-compose |
| Session store | In-memory (30-min TTL, no database) |

---

## Quick Start

### Prerequisites
- Python 3.11+
- Node.js 18+
- (Optional) Docker + docker-compose

### Run Locally — Without Docker

**Backend**
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**Frontend** (separate terminal)
```bash
cd frontend
npm install
npm run dev
# Opens at http://localhost:5173
```

### Run with Docker
```bash
docker-compose up --build
# Backend: http://localhost:8000
# Frontend: http://localhost:3000
```

---

## File Requirements

### SAP AR Ledger (`.xlsx`)
- Standard SAP FBL5N / AR Ledger export
- Column positions are **positional** (do not rename or reorder columns):

| Col Index | Field | Used For |
|---|---|---|
| 4 | Clearing Document | Phase A group matching |
| 5 | Document Type | Gate filter (RV/DC/DR pass; CC/BR excluded) |
| 6 | Document Date | FY date window filter |
| 8 | Special G/L Indicator | Gate filter (L/E/U excluded; V/O/A/N flagged) |
| 10 | Amount in Local Currency | Match amount |
| 14 | Invoice Reference | Uniqueness guard (Section 199) |

- **Filename convention:** Use the deductor/company name in the filename (e.g., `MICRONOVA_TECH_SAP.xlsx`). This is used for automatic name alignment in batch mode.

### Form 26AS (`.xlsx`)
- Downloaded from TRACES portal
- Standard format with headers in the first 5 rows
- Only rows with **Status = "F"** (Final) are processed
- Amount column used: **"Amount Paid/Credited"** (gross amount, not TDS deducted)

---

## Output — Excel Workbook

### Single-Party Output (5 sheets)

| Sheet | Contents |
|---|---|
| Summary | Run metadata, match rate, confidence breakdown, cleaning report |
| Matched Pairs | All matched entries with invoice refs, variance %, confidence tier, match type |
| Unmatched 26AS | 26AS entries with no SAP match, with reason codes |
| Unmatched Books | SAP entries not used in any match |
| Variance Analysis | Variance distribution for matched pairs |

### Batch Output (1 + 4×N sheets)

| Sheet | Contents |
|---|---|
| Master Summary | One row per deductor: match rate, counts, violations, confidence breakdown |
| `{Name}_Match` | Matched pairs for each party |
| `{Name}_Un26AS` | Unmatched 26AS for each party |
| `{Name}_UnBks` | Unmatched books for each party |
| `{Name}_Var` | Variance analysis for each party |

---

## Confidence Tiers

| Tier | Condition | Action Required |
|---|---|---|
| HIGH | Variance ≤ 1%, not a FORCE or PRIOR match | Low — standard review |
| MEDIUM | Variance 1–5%, not a FORCE or PRIOR match | Review recommended |
| LOW | Any FORCE_ or PRIOR_YEAR_EXCEPTION match | Mandatory CA review |

---

## Unmatched Reason Codes

| Code | Meaning |
|---|---|
| U01 | Best available SAP invoice covers less than 50% of 26AS amount |
| U02 | Closest match exceeds variance ceiling |
| U04 | Only prior-year invoices available and cross-FY matching is disabled |

---

## Key Compliance Controls

- **Section 199 hard constraint:** `books_sum` (sum of matched SAP invoices) can never exceed `as26_amount` (the 26AS credit amount)
- **Invoice uniqueness:** Each SAP invoice reference can back at most one 26AS match (`consumed_invoice_refs` guard)
- **Cross-FY segregation:** Prior-FY SAP invoices are held separate (Phase E only) and tagged `PRIOR_YEAR_EXCEPTION` with LOW confidence — requires explicit CA review
- **Post-run validation:** Four assertions checked after every run (invoice uniqueness, books ≤ 26AS, combo cap, FY boundary)

---

## Configuration

All tunable parameters are in `backend/config.py`. Never hardcode values in business logic.

| Parameter | Default | Description |
|---|---|---|
| `VARIANCE_CAP_SINGLE` | 2.0% | Max variance for SINGLE match |
| `VARIANCE_CAP_COMBO` | 3.0% | Max variance for COMBO (3–5 invoices) |
| `VARIANCE_CAP_CLR_GROUP` | 3.0% | Max variance for CLR_GROUP match |
| `VARIANCE_CAP_FORCE_SINGLE` | 5.0% | Max variance for FORCE_SINGLE (last resort) |
| `FORCE_COMBO_MAX_INVOICES` | 3 | Max invoices in a FORCE_COMBO match |
| `FORCE_COMBO_MAX_VARIANCE` | 2.0% | Max variance for FORCE_COMBO |
| `MAX_COMBO_SIZE` | 5 | Hard cap on combo size across all phases |
| `COMBO_LIMIT` | 500 | Max combinations tried per size level in Phase B |
| `ALLOW_CROSS_FY` | False | Enable prior-FY matching in Phases A/B/C |
| `SAP_LOOKBACK_YEARS` | 1 | How many prior FYs to load into the SAP pool |
| `NOISE_THRESHOLD` | ₹1.0 | Rows below this amount excluded |
| `SESSION_TTL_SECONDS` | 1800 | Session expiry (30 minutes) |
| `DEFAULT_FINANCIAL_YEAR` | FY2023-24 | Default FY if none selected |

---

## Project Structure

```
26AS-Matcher/
├── VERSION                         # Current version (1.0.0)
├── CHANGELOG.md                    # Version history
├── docker-compose.yml
├── docs/
│   ├── ALGORITHM.md                # 5-phase engine deep-dive
│   ├── API.md                      # REST API reference
│   └── KNOWN_GAPS.md               # Honest gap register
├── backend/
│   ├── main.py                     # FastAPI routes
│   ├── reco_engine.py              # 5-phase reconciliation algorithm (v5)
│   ├── cleaner.py                  # SAP AR Ledger cleaning pipeline
│   ├── parser_26as.py              # 26AS Excel parser
│   ├── aligner.py                  # Fuzzy deductor name matching + session store
│   ├── batch_engine.py             # Batch auto-mapping + orchestration
│   ├── excel_generator.py          # Single-party Excel output
│   ├── batch_excel.py              # Batch combined Excel output
│   ├── models.py                   # Pydantic data models
│   ├── config.py                   # All tunable constants
│   ├── requirements.txt
│   └── Dockerfile
└── frontend/
    ├── src/
    │   ├── App.tsx                  # Page state machine
    │   ├── api.ts                   # API client
    │   └── components/
    │       ├── UploadPage.tsx       # Single-party upload
    │       ├── ProcessingSpinner.tsx
    │       ├── AlignmentPage.tsx    # Deductor name confirmation
    │       ├── ResultsPage.tsx      # Single-party results
    │       ├── BatchUploadPage.tsx  # Batch upload
    │       ├── BatchMappingPage.tsx # Batch name mapping review
    │       └── BatchResultsPage.tsx # Batch results + download
    └── package.json
```

---

## Known Limitations

This is a **working-paper tool** — not a production-certified reconciliation system. See [docs/KNOWN_GAPS.md](docs/KNOWN_GAPS.md) for the full gap register.

Key limitations a CA must be aware of:
- Matching algorithm is greedy (not globally optimal — processing order affects results)
- No TDS section segregation in matching logic (194C and 194J entries share the same pool)
- No invoice date proximity scoring in match selection
- No PAN validation or 206AA detection
- No input file integrity hashing
- Session data is lost on server restart — the downloaded Excel is the only persistent record
- No user authentication or access control

---

## Version History

See [CHANGELOG.md](CHANGELOG.md).

---

## Deployment Gate (CRB March 2026)

Algorithm v5 must be re-benchmarked on the FY2023-24 reference dataset before use in client deliverables:

- Target: matched ≥ 99%
- Variance ceiling compliance: 100%
- Invoice reuse: 0
- Cross-FY bleed: 0

Status: **Pending validation run**

---

## Built By

HRA & Co. / Akurat Advisory — Internal reconciliation tooling
Algorithm design: Change Request Brief, March 2026
