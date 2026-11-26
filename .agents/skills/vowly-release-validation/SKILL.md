---
name: vowly-release-validation
description: >-
  Executes Vowly's pre-merge release validation gate: automated tests, live Gemini
  evaluations, browser-based end-to-end UAT with UX metrics, independent code review,
  and PM approval readiness. Use before merging any release or user-facing PR.
---

# Vowly Release Validation Workflow

Run this four-stage gate (`tests → live evals → browser UAT → review`) before requesting PM merge approval on a PR.

## 1. Automated Offline Tests & Builds

Run and confirm 100% pass:
- Backend unit tests: `npm test`
- Backend offline evals: `npm run eval -- --provider mock`
- Frontend regression & parity tests: `cd frontend && npm test`
- Frontend type-check & production build: `cd frontend && npm run lint && npm run build`

## 2. Live Model Evaluations (When Extraction Changed)

1. Confirm `GEMINI_API_KEY` is configured server-side (never expose or log the key).
2. Run `npm run eval -- --provider gemini` across all splits (including new UAT cases).
3. Verify **0 critical financial errors**, **0 unsupported currency guesses**, and no unexplained regressions vs. the baseline in `docs/EVAL_REPORT.md`.
4. Record exact resolved model version, dataset version, accuracy, latency, retries, token usage, and estimated cost per successful extraction separately from mock results.

## 3. Browser-Based End-to-End UAT & UX Validation

Start the local servers (`PORT=3001 EXTRACTOR_PROVIDER=gemini npm run ui` and `cd frontend && npm run dev` at `http://localhost:3000`) and run E2E UAT via Antigravity's `browser` subagent or structured manual UAT:

- **Functional & financial safeguards:**
  - Paste a quote with unresolved mandatory fee or unknown gratuity % → verify labeled `Incomplete estimate`, approval/booking blocked, and `Save as Draft` preserves approved budget & event associations.
  - Paste a negotiated quote → verify negotiated savings shown without false price conflict.
  - Upload two distinct quote images/PDFs → verify distinct, grounded extractions (no placeholder data).
  - Confirm booking on an eligible vendor → verify deposits default to **unpaid**, installments reconcile to contract total, and relative deadlines compute from the selected event date.
  - Verify editing/approving one vendor's quote never removes or overwrites another vendor.
- **UX validation metrics:**
  - Record **time to a correct vendor comparison**.
  - Record **number of manual corrections required** per imported quote.
  - Verify the user can understand **pricing, inclusions, missing information, and payment obligations** without rereading the original quote.

## 4. Independent Review, Privacy Audit & PM Gate

1. Scan changed files to confirm **0 API keys, credentials, or personal wedding data** are committed and no raw uploaded documents are logged.
2. Obtain an **independent code review** (Codex PR review and/or a separate review subagent) for significant changes, address all findings, and add regression tests for caught bugs.
3. Post the full verification summary (offline tests, live evals, browser UAT/UX results, unresolved issues, and follow-up work) on the PR.
4. **Stop and wait for explicit PM approval before merging.**
