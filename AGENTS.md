# Vowly Project Instructions (`AGENTS.md`)

Persistent engineering, product, and evaluation rules for all agents working in `nimish-hegde/vowly`.

## 1. Product Architecture & Objectives

Vowly is an AI-powered wedding planning and financial decision workspace that makes importing, understanding, and comparing vendor quotes dramatically easier than managing spreadsheets.

- **Backend & eval harness (`src/`, `eval-data/`, `ui/`):** Node.js + TypeScript quote extraction pipeline (`extractor.ts`), schema/evidence validator (`validator.ts`), deterministic calculator (`calculator.ts`), review session safeguards (`review.ts`), telemetry (`telemetry.ts`), local HTTP server (`server.ts`), and evaluation runner (`eval.ts`).
- **Frontend (`frontend/`):** React + TypeScript + Vite + Tailwind CSS v4 planning workspace (`src/components/`, `src/engine/`, `src/services/`, `src/store/`, `src/types/`).
- **Documentation (`docs/`, `README.md`, `CHANGELOG.md`):** Product spec ([docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md)), living roadmap & decision log ([docs/ROADMAP.md](docs/ROADMAP.md)), and AI evaluation report ([docs/EVAL_REPORT.md](docs/EVAL_REPORT.md)).

## 2. Core Architectural Boundary: AI Extracts Facts, Deterministic Code Calculates

- **AI extracts structured facts only.** Never ask the model to compute totals, subtotals, taxes, gratuities, staffing counts, or choose between conflicting prices.
- **Deterministic code calculates all financial outcomes.** All arithmetic, minimum guest floors, staffing ratios, percentage bases, tax/gratuity rules, negotiated savings, and booking/approval gates live in deterministic TypeScript (`src/calculator.ts` and `frontend/src/engine/financialCalculator.ts`).
- **Maintain backend/frontend calculation parity.** Avoid diverging calculation logic; enforce parity across backend and frontend calculators through shared helpers or identical test fixtures.
- **Percentage charges require explicit structured bases** (`specific_line_items`, `food_subtotal`, `entire_subtotal`, `custom_amount`, or `unknown`). Never infer tax treatment from payment method (e.g., cash is never assumed tax-free), and never apply tax or gratuity twice.

## 3. Financial States & Human Approval Gates

Preserve four distinct financial states at all times:

1. **Draft / incomplete quote** — Saved without changing approved projected spend, event associations, or existing vendor metadata.
2. **Reviewed quote (projected budget)** — Explicitly approved by the user; counts toward projected spend only if selected as preferred (never double-counting competing alternatives).
3. **Confirmed booking** — Explicitly confirmed through the booking flow with an agreed contract total and payment schedule reconciled to the contract total without double-counting.
4. **Paid amount** — Deposits and installments default to **unpaid** (`Upcoming`) until explicitly confirmed paid by the user.

**Mandatory Safeguards:**
- Incomplete quotes may always be saved as drafts, and incomplete estimates must be clearly labeled.
- Never silently include unresolved mandatory costs in a complete estimate.
- Unresolved mandatory fees, unknown currency, unresolved price conflicts, unknown mandatory gratuity percentage, unresolved percentage calculation bases, pending draft reviews, or unacknowledged source warnings **must block approval and booking** across every UI entry point and underlying store/backend mutation.

## 4. Source Grounding & Preserving Unknowns

- **Pasted text:** Every extracted line item, conflicting option, and open question must carry a verbatim `sourceExcerpt` grounded in the raw message.
- **Uploaded images & PDFs:** Track document evidence with visible `sourceExcerpt` snippets and `pageReference` where available. Do not silently accept unsupported extracted values.
- **Never fabricate missing data:** Unknown vendor names, locations, currencies (`UNKNOWN`), tax percentages, gratuity percentages, or package inclusions must remain unknown/null until confirmed by the user.
- **Negotiated prices vs. conflicts:** Distinguish explicit negotiated discounts (`"normally $1,000, $900 for you"` → active price + savings, no false conflict) from genuinely unexplained conflicting prices across sources (requires user resolution).

## 5. Privacy & API Credential Handling

- Keep `GEMINI_API_KEY` and all provider credentials strictly server-side (`process.env` or gitignored `.env`). Never expose API keys in frontend bundles, logs, commits, or PR comments.
- Never commit personal wedding data; keep real couples' data and telemetry inside gitignored `private-data/`.
- Inform users clearly when uploaded documents are sent to the configured AI provider, validate file format and size, and never log raw uploaded documents or base64 payloads.
- Retain explicit mock mode for offline tests, but **never silently substitute mocked results when live extraction fails**.

## 6. PM-Owned Release Gates

- Define measurable acceptance criteria in the plan / [docs/ROADMAP.md](docs/ROADMAP.md) before starting implementation.
- **Critical financial errors are release blockers** (wrong subtotals, double-counted prices, unsupported currency assumptions, silently dropped mandatory fees, or bypassed booking/approval gates).
- Never merge a PR automatically; **explicit PM/user approval is required before merging**.

## 7. AI Evaluation & Regression Testing Standards

- **Required offline checks before every push:**
  - Backend unit tests: `npm test`
  - Offline mock evals: `npm run eval -- --provider mock`
  - Frontend tests, type-check & build: `cd frontend && npm test && npm run lint && npm run build`
- **Live evaluation standards:**
  - Always distinguish mock results from live model performance. Never claim extraction readiness from mock evals alone.
  - Track and report: end-to-end accuracy, field-level accuracy, source grounding, false positives, missed mandatory charges, human correction rate, latency (including and excluding retries), retries, and cost per successful extraction (and cost per accepted quote as telemetry matures).
  - Record exact resolved model versions and evaluation dataset versions in [docs/EVAL_REPORT.md](docs/EVAL_REPORT.md).
  - **Holdout integrity:** Never tune against or alter locked `regression/`, `held-out/`, or `held-out-v2/` datasets to make a change pass. Add new cases to `dev/` or a new versioned holdout split.

## 8. User Experience Validation & Browser E2E UAT

For user-facing changes, validate in a real browser (using Antigravity's `browser` subagent or manual local UAT) before release:
- Measure **time to a correct vendor comparison**.
- Track the **number of manual corrections required** per imported quote.
- Verify users can understand **pricing, inclusions, missing information, and payment obligations** without rereading the original quote.
- Verify end-to-end flows including actual multimodal uploads (distinct files produce distinct grounded extractions), draft isolation, blocker enforcement, and unpaid-by-default deposits.

## 9. Agent Orchestration & Independent Review

Use specialized agents (`invoke_subagent` / `define_subagent` / `browser`) when scope or complexity warrants it, with clear ownership boundaries and deliverables. The **primary agent** owns integration, cross-layer parity, and final verification.

| Role | Primary Ownership | Key Deliverables |
|---|---|---|
| **Extraction Specialist** | `src/types.ts`, `src/extractor.ts`, `src/validator.ts`, `eval-data/` | Prompt/schema updates, multimodal handling, evidence validation, eval grading & failure analysis. |
| **Financial Engine Specialist** | `src/calculator.ts`, `src/review.ts`, `frontend/src/engine/`, `frontend/src/store/workspaceTransitions.ts` | Deterministic math, percentage bases, booking/approval gates, backend/frontend parity fixtures. |
| **Frontend UX Specialist** | `frontend/src/components/`, `frontend/src/services/` | Progressive-disclosure review UI, loading/error recovery, workspace state transitions. |
| **QA & Release Verifier** | Offline suites, live Gemini evals, `browser` E2E UAT, secret/privacy audit | Test & eval tables, UX validation findings, regression verification. |
| **Independent Reviewer** | Unbiased diff review (Codex PR review and/or separate review subagent) | Required for significant changes; catches financial, state, and edge-case bugs before merge. |

## 10. Development Evidence & Documentation

- Maintain the living milestone tracker and versioned decision log in [docs/ROADMAP.md](docs/ROADMAP.md) (hypotheses, changes, evaluation results, failures, trade-offs, cost per accepted quote / unit economics, and ship/hold decisions).
- Keep [README.md](README.md), [CHANGELOG.md](CHANGELOG.md), [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md), and [docs/EVAL_REPORT.md](docs/EVAL_REPORT.md) synchronized without duplicating details or overstating results.
- Activate the workspace skills in `.agents/skills/` for structured workflows:
  - `vowly-feature-dev` — Requirements → plan → implementation
  - `vowly-ai-eval` — Benchmark → failure analysis → fix → retest
  - `vowly-release-validation` — Tests → live evals → browser UAT → review
  - `vowly-docs-sync` — Roadmap, decision log, changelog, and evaluation evidence
