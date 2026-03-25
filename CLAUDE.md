# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Indian income-tax TDS reconciliation tool for chartered accountants. Matches government Form 26AS entries against a company's SAP AR Ledger to verify TDS credit claims under Section 199 of the Income Tax Act.

## Commands

### Backend (run from `backend/`)
```bash
# Install dependencies
pip install -r requirements_v2.txt

# Start dev server (auto-reload)
uvicorn main_v2:app --reload --port 8000

# Run all tests
pytest tests/ -v

# Run a single test
pytest tests/test_optimizer.py -v
pytest tests/test_validator.py::test_section199_hard_assert -v

# Run benchmark
python benchmark.py
```

### Frontend (run from `frontend/`)
```bash
npm install
npm run dev          # Vite dev server on port 3000
npm run build        # TypeScript check + production build
npm run lint         # ESLint
```

### Full stack
Start backend on port 8000 and frontend on port 3000. Vite proxies `/api` requests to the backend (configured in `vite.config.ts`). Default login: `admin@tds.com` / `admin123`.

## Architecture

### Two entry points (v1 vs v2)
- `backend/main_v2.py` — current app (FastAPI + SQLAlchemy async + JWT auth)
- `backend/main.py` — v1 fallback (in-memory sessions, no DB, greedy algorithm)

Always use `main_v2.py`. The v1 files (`main.py`, `reco_engine.py`, `batch_engine.py`) remain for reference.

### Backend structure
```
backend/
├── main_v2.py              # FastAPI app entry + lifespan
├── config.py               # Algorithm constants (variance caps, combo limits, FY config)
├── core/
│   ├── settings.py          # Env-based config via pydantic-settings (.env file)
│   ├── security.py          # JWT + bcrypt + API keys
│   ├── audit.py             # Dual-sink audit (DB + JSONL files)
│   └── deps.py              # FastAPI dependency injection
├── db/
│   ├── base.py              # Async engine, session factory, table creation
│   └── models.py            # SQLAlchemy models (10 tables)
├── engine/
│   ├── optimizer.py         # Core algorithm: scipy bipartite + PuLP ILP + combo matching
│   ├── validator.py         # 6 pre-match validators
│   ├── scorer.py            # 5-factor composite scoring
│   ├── exception_engine.py  # Auto-generates REQUIRES_REVIEW items
│   └── ...                  # Additional engines (chunking, duplicate, false_positive, etc.)
├── services/
│   ├── reconcile_service.py # Full pipeline orchestrator (phases A→E)
│   ├── excel_v2.py          # 6-sheet Excel output with audit metadata
│   ├── progress_store.py    # In-memory real-time progress tracking
│   └── evidence_pack.py     # Evidence packaging
├── api/routes/
│   ├── auth.py              # Login, register, token refresh
│   └── runs.py              # CRUD + async processing endpoints
├── parser_26as.py           # 26AS Excel parser (Status=F rows, auto-header detection)
└── tests/                   # pytest + pytest-asyncio
```

### Frontend structure
```
frontend/src/
├── lib/
│   ├── api.ts               # Axios client, all API calls, type definitions
│   ├── auth.tsx             # AuthContext, JWT storage, login/logout
│   └── utils.ts             # Formatters (date, pct, FY), status helpers
├── pages/
│   ├── DashboardPage.tsx    # Stats, recent runs table, match rate chart
│   ├── NewRunPage.tsx       # Single/Batch upload with party mapping
│   ├── RunDetailPage.tsx    # Results, match table, approve/reject
│   ├── RunHistoryPage.tsx   # Filterable run list
│   ├── AdminPage.tsx        # User management (ADMIN only)
│   └── LoginPage.tsx / SetupPage.tsx
└── components/ui/           # Reusable: Card, Badge, Table, Spinner, etc.
```

### Reconciliation algorithm (5 phases)
1. **Phase A** — Clearing Group matching (2–5 entries, ≤3% variance)
2. **Phase B** — Individual: Exact → SINGLE (≤2%) → COMBO_2–5 (≤3%), per-size combo budget
3. **Phase C** — Restricted Force-Match: FORCE_SINGLE ≤5%, FORCE_COMBO max 3 invoices ≤2%
4. **Phase E** — Prior-Year Exception (only when `ALLOW_CROSS_FY=False`)
5. **Phase D** — Truly unmatched with reason codes (U01/U02/U04)

### Critical compliance rules
- `books_sum` must NEVER exceed `as26_amount` (Section 199 hard assert)
- Same invoice cannot back two different matches (`consumed_invoice_refs` set)
- `MAX_COMBO_SIZE=5` enforced in ALL phases
- Combo matching has pool cap (50 books) + iteration budget (50K) to prevent combinatorial explosion

### Async processing
`POST /api/runs` and `POST /api/runs/batch` return immediately (202). Processing runs via `asyncio.create_task` with separate DB sessions. Frontend polls progress via `/api/runs/{id}/progress` every 800ms.

## Key Conventions

- **Database**: SQLite with WAL mode in dev, PostgreSQL in prod. Async only (aiosqlite / asyncpg).
- **Auth**: JWT + bcrypt. Three roles: ADMIN, REVIEWER, PREPARER.
- **Config split**: Algorithm constants in `config.py`, environment config in `core/settings.py` via `.env`.
- **SAP columns are positional** (not by name): col[4]=ClearingDoc, col[5]=DocType, col[6]=DocDate, col[8]=SGL, col[10]=Amount, col[14]=InvoiceRef.
- **26AS parsing**: Status=F rows only, "Amount Paid/Credited" column (NOT Tax Deducted), header auto-detected within first 5 rows.
- **PuLP CBC**: May fail on Apple Silicon (x86_64 binary). Runtime detection with subprocess test, graceful fallback to scipy/greedy.
- **Color theme**: Primary brand color is `#1B3A5C` (navy blue).
