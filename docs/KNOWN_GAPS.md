# Known Gaps Register — v1.0.0

**As of:** 2026-03-18
**Reviewed by:** Development team + CA benchmarking (CRB March 2026)
**Purpose:** Transparent record of known limitations for internal use, CA oversight, and client disclosure

This document is updated with each release. Gaps are classified by risk level and whether they affect algorithm correctness, compliance, auditability, or security.

---

## BLOCKING — Must resolve before production certification

### G-BLK-01: CRB Deployment Gate Not Cleared

**Area:** Algorithm validation
**Description:** Algorithm v5 has not been re-benchmarked on the reference dataset (FY2023-24, one deductor, 9,624 SAP rows, 4,648 26AS entries) since the CRB changes were implemented. The CRB requires this validation before any client deliverables.
**Targets:**
- Matched ≥ 99%
- Variance ceiling compliance: 100%
- Invoice reuse: 0
- Cross-FY bleed: 0
**Workaround:** CA must manually review all output before use in client deliverables.
**Fix:** Re-run the benchmark dataset and record results.

---

## HIGH RISK

### G-HIGH-01: No User Authentication or Access Control

**Area:** Security
**Description:** Anyone with the server URL can upload files, run reconciliations, and download output. No login, no roles, no IP restriction, no rate limiting.
**Risk:** Sensitive financial data (SAP ledgers, Form 26AS) exposed to any network actor who can reach the server.
**Workaround:** Keep the server on a private network (localhost or VPN only). Do not expose publicly.
**Fix:** Add API key authentication or OAuth2 login with role-based access (upload, run, download).

---

### G-HIGH-02: No Input File Integrity Hashing

**Area:** Auditability / Tamper evidence
**Description:** Input files are not checksummed (SHA-256 or MD5). The output Excel does not embed any hash of the inputs. If an input file is modified after the reconciliation was run and re-uploaded, there is no way to detect the discrepancy.
**Risk:** In scrutiny proceedings, the integrity of the reconciliation cannot be proven from the output alone.
**Workaround:** CA to retain the original input files with file system timestamps as evidence.
**Fix:** Compute SHA-256 of each input file on upload; embed hash in the output Excel Summary sheet.

---

### G-HIGH-03: No Persistent Audit Trail

**Area:** Auditability
**Description:** Session data (input files, alignment choices, results) is stored in-memory only and lost after 30 minutes or on server restart. Console logs are the only record of server-side activity.
**Risk:** Cannot re-perform or reconstruct a historical run. Manual overrides (deductor name confirmations) are not logged.
**Workaround:** Download the Excel output immediately after each run. Retain downloaded files.
**Fix:** Write a structured run log (JSON) to disk on each reconciliation completion; include session ID, timestamp, input file names, alignment choices, and summary statistics.

---

### G-HIGH-04: Algorithm Version Not Stamped on Output Excel

**Area:** Auditability / Run consistency
**Description:** The output Excel does not record which algorithm version (v5.0) or code commit hash was used to produce the results. If config parameters change between runs, there is no way to detect version divergence from the output alone.
**Risk:** Comparing outputs across time or code versions is unreliable.
**Workaround:** Record the download date and manually note the algorithm version.
**Fix:** Add algorithm version, run timestamp, and key config parameters (variance caps, MAX_COMBO_SIZE, ALLOW_CROSS_FY) to the Summary sheet header.

---

### G-HIGH-05: PAN Not Captured — 206AA Detection Impossible

**Area:** Tax law compliance
**Description:** PAN is not extracted from either SAP or Form 26AS. The system cannot detect:
- Higher TDS rate applied due to PAN non-availability (Section 206AA — 20% or twice the rate)
- PAN mismatch between deductor records and PAN database
- Entries where TDS rate implies PAN issues
**Risk:** 206AA exposure goes undetected; TDS credit claims may be challenged.
**Workaround:** CA must manually check TDS rate-derived gross amounts for 206AA indicators.
**Fix:** Parse "Tax Deducted" column from 26AS; compute implied rate; flag entries where rate > 10% as potential 206AA cases.

---

### G-HIGH-06: Amount-Level Control Totals Not Balanced

**Area:** Data integrity
**Description:** The output does not verify or display:
- Sum of all matched 26AS amounts + sum of all unmatched 26AS amounts = total 26AS amount
- Sum of all matched SAP amounts + sum of all unmatched SAP amounts = total SAP amount
Without this, a silent data loss (rows dropped during cleaning) cannot be detected from the output alone.
**Workaround:** CA to manually total columns in the output and cross-check against source files.
**Fix:** Add a control totals row to the Summary sheet.

---

## MEDIUM RISK

### G-MED-01: No TDS Section Segregation in Matching

**Area:** Algorithm correctness / Tax law compliance
**Description:** Section code (194C, 194J, 194I, etc.) is parsed from 26AS and stored in the output but is NOT used as a matching filter. A 194C (contractor) 26AS entry can be matched to SAP invoices that belong to a 194J (professional fees) transaction.
**Risk:** Technically matched but legally incorrect pairings. Section 199 credit is section-specific.
**Workaround:** CA must verify section alignment for every non-EXACT match in the output.
**Fix:** Add section as a mandatory matching criterion — only allow book entries where the SAP GL/cost centre implies the same section as the 26AS entry. (Requires additional SAP data mapping.)

---

### G-MED-02: No Invoice Date Proximity Scoring

**Area:** Algorithm correctness
**Description:** Invoice date (`doc_date`) is used only for FY boundary filtering. It is not used to score or rank matches. A 26AS credit dated Jun 2023 can be matched to an invoice dated Mar 2023 or Jan 2024 with no differentiation.
**Risk:** Temporally implausible matches are accepted if amounts align within tolerance.
**Workaround:** CA to review invoice dates in the Matched Pairs sheet and flag implausible date gaps.
**Fix:** Add a date proximity score component; penalise or reject matches where date gap exceeds a configurable threshold (e.g., 90 days).

---

### G-MED-03: Global Matching Is Greedy, Not Optimal

**Area:** Algorithm correctness
**Description:** The algorithm processes 26AS entries in ascending amount order and commits book entries greedily. A book entry consumed by entry #1 is unavailable for entry #2, even if entry #2 would have produced a better overall result.
**Risk:** The globally optimal set of matches is not guaranteed. Running the same data in different input order produces different results. The % of cases affected is unknown (never tested).
**Workaround:** Accept the working-paper nature of the output and treat unmatched entries as requiring manual investigation.
**Fix:** Implement bipartite graph matching (e.g., Hungarian algorithm or ILP) for the exact and single-match phases. Combo phases remain heuristic due to NP-hard complexity.

---

### G-MED-04: 26AS Duplicate / Revision Detection Absent

**Area:** Data quality
**Description:** The parser filters Status=F (Final) only. However, if the same deductor filed and then revised the same quarter, both the original and revised entry could appear as Status=F. The system will attempt to match both, potentially consuming two sets of invoices for what is legally one TDS credit.
**Risk:** Double-counting of TDS credits.
**Workaround:** CA to verify no duplicate (deductor + quarter + amount) entries exist in the 26AS before uploading.
**Fix:** Add quarter-wise deduplication logic; flag entries where the same deductor has multiple Status=F entries for the same quarter and amount.

---

### G-MED-05: No Stress Testing Beyond One Dataset

**Area:** Performance / Reliability
**Description:** The system has been tested on one dataset (one deductor, one FY, 9,624 SAP rows, 4,648 26AS entries). No stress testing has been done at:
- 50,000+ SAP rows
- 10,000+ 26AS entries
- 10+ parties in one batch
- Concurrent users
**Risk:** Unknown failure points, potential memory exhaustion, session concurrency issues.
**Workaround:** Keep batch sizes small; avoid concurrent use by multiple users.
**Fix:** Stress test, add memory limits per session, add async task queue for large runs.

---

### G-MED-06: Manual Overrides Not Logged to Persistent Audit Trail

**Area:** Auditability / Governance
**Description:** When a user manually confirms or overrides a deductor name alignment, this action is not written to any persistent log. After the session expires, there is no record of what override was made, by whom, or why.
**Workaround:** CA to note manual alignment decisions separately.
**Fix:** Part of G-HIGH-03 (persistent run log) — include alignment decisions in the log.

---

### G-MED-07: No Approval or Workflow Layer

**Area:** Governance
**Description:** Any user can run a reconciliation and download the output without any second-person review or approval step. There is no maker-checker control.
**Workaround:** Enforce process discipline outside the system (CA reviews all output before use).
**Fix:** Add an approval workflow — preparer runs, reviewer approves before download is enabled.

---

## LOW RISK

### G-LOW-01: No Match Type Distribution Report

**Area:** Output quality
**Description:** The output Excel shows confidence tiers (HIGH/MEDIUM/LOW) in the Summary sheet but does not show match type distribution (% EXACT, % SINGLE, % COMBO, % FORCE). A high FORCE% or high COMBO% signals a weak reconciliation but is not immediately visible.
**Workaround:** CA can manually count match types in the Matched Pairs sheet.
**Fix:** Add a match type breakdown table to the Summary sheet.

---

### G-LOW-02: Alternate Combinations Never Shown

**Area:** Transparency
**Description:** For each 26AS entry, only the first valid match found is returned. Alternative combinations (other sets of invoices that would also satisfy the match criteria) are never computed or presented. A CA cannot see "what else could have matched" without re-running with modified data.
**Workaround:** None within the current system — manual investigation required for disputed matches.
**Fix:** For COMBO matches, enumerate and store top 3 valid alternatives by variance; display in output.

---

### G-LOW-03: No Reversal / Credit Note Handling

**Area:** Algorithm correctness
**Description:** Negative SAP amounts (credit notes, reversals) are excluded in the cleaning pipeline. If a deductor recalled or reversed a TDS credit, the negative 26AS entry is ignored. The 26AS total will be overstated by the reversal amount.
**Workaround:** CA to manually identify and adjust for reversal entries.
**Fix:** Parse negative 26AS entries separately; treat them as adjustments that reduce the gross 26AS amount for the affected deductor.

---

### G-LOW-04: TAN Cross-Entity Risk Within One Upload

**Area:** Data quality
**Description:** If one TAN covers multiple divisions or branches, all their payments appear in the same 26AS section. If the CA uploads an SAP file that also contains invoices from multiple divisions under the same TAN, cross-division matches can occur.
**Workaround:** CA to ensure each SAP upload file contains only the invoices relevant to the specific entity/division being reconciled.
**Fix:** Add a division/profit-centre filter option in the SAP file upload; add a warning when the SAP file appears to contain entries from multiple business units.

---

## GAP SUMMARY TABLE

| ID | Risk | Area | Fixed in v1.0.0 | Target Fix |
|---|---|---|---|---|
| G-BLK-01 | Blocking | Algorithm validation | No | Before client use |
| G-HIGH-01 | High | Security | No | v1.1.0 |
| G-HIGH-02 | High | Auditability | No | v1.1.0 |
| G-HIGH-03 | High | Auditability | No | v1.1.0 |
| G-HIGH-04 | High | Auditability | No | v1.1.0 |
| G-HIGH-05 | High | Tax compliance | No | v1.2.0 |
| G-HIGH-06 | High | Data integrity | No | v1.1.0 |
| G-MED-01 | Medium | Tax compliance | No | v1.2.0 |
| G-MED-02 | Medium | Algorithm | No | v1.2.0 |
| G-MED-03 | Medium | Algorithm | No | v2.0.0 |
| G-MED-04 | Medium | Data quality | No | v1.2.0 |
| G-MED-05 | Medium | Performance | No | v1.2.0 |
| G-MED-06 | Medium | Governance | No | v1.1.0 |
| G-MED-07 | Medium | Governance | No | v2.0.0 |
| G-LOW-01 | Low | Output quality | No | v1.1.0 |
| G-LOW-02 | Low | Transparency | No | v2.0.0 |
| G-LOW-03 | Low | Algorithm | No | v1.2.0 |
| G-LOW-04 | Low | Data quality | No | v1.2.0 |

---

## What IS Working Correctly in v1.0.0

- Section 199 hard constraint (`books_sum ≤ as26_amount`) — verified by post-run assertion
- Invoice uniqueness guard (`consumed_invoice_refs`) — prevents double-claiming
- Cross-FY segregation (`ALLOW_CROSS_FY=False`) — prior-year books correctly isolated to Phase E
- MAX_COMBO_SIZE=5 enforced in all phases including CLR_GROUP
- Tier-specific variance ceilings applied correctly per phase
- Deduplication by `(invoice_ref, clearing_doc)` pair — preserves valid payment events
- FORCE_COMBO restricted to 3 invoices and 2% variance (eliminates garbage 529-invoice matches from pre-CRB)
- Status=F filter on 26AS (Final bookings only)
- Fuzzy name alignment with auto-confirm and manual override
- Batch mode: auto-mapping + combined Excel workbook
- Post-run compliance validation (4 assertions, raises RuntimeError on failure)
