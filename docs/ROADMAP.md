# Vowly Roadmap & Decision Log

**Last updated:** November 26, 2026  
**Related docs:** [Product spec](PRODUCT_SPEC.md) · [AI eval report](EVAL_REPORT.md) · [Changelog](../CHANGELOG.md) · [Agent instructions](../AGENTS.md)

This document is the single living tracker for Vowly milestones, PM-owned acceptance criteria, unit-economics observations, and versioned ship/hold decisions. Avoid duplicating detailed benchmark tables from [EVAL_REPORT.md](EVAL_REPORT.md) or release bullet points from [CHANGELOG.md](../CHANGELOG.md); link to them instead.

---

## Living Milestone & Acceptance-Criteria Tracker (Nov 26, 2026)

| Milestone | Scope | Measurable Acceptance Criteria (PM Gate) | Status | Ship / Hold |
|---|---|---|---|---|
| **v0.2 / v0.2.1** | Product definition & static concepts | PRD aligned with pilot scope, vendor/task statuses defined, privacy rules documented. | Done (`#6`) | Shipped |
| **v0.3** | AI quote extraction pipeline, 60-case eval harness, local Quote Review UI & telemetry | ≥95% live e2e accuracy on 60-case suite; **0 critical financial errors**; **0 unsupported currency guesses**; explicit human approval gate before budget mutation. | Done (`#8`, `#10`, `#11`) | Shipped (`59/60` live + overtime fix verified offline) |
| **v0.4** | Interactive React frontend prototype (`frontend/`, mock mode) & financial safeguards | Production build + type-check pass; centralized booking eligibility across all entry points; draft revision isolation; unpaid-by-default deposits; 0 secrets/personal data. | Done (`#12`) | Shipped |
| **v0.4.x (Framework)** | Reusable Antigravity development framework (`AGENTS.md`, 4 workflow skills, roadmap/decision log, PR template) | Persistent rules cover architecture, financial safeguards, eval standards, UX metrics, agent orchestration, and PM gates; zero application code changes. | Done (`#14`) | Shipped |
| **v0.5** | Real multimodal AI quote import & progressive-disclosure quote review | Real Gemini text/image/PDF extraction via server-side API; structured percentage bases & inclusions; negotiated savings without false conflicts; live Gemini evals with **0 critical financial errors** and no regression vs. `v0.3`; live browser UAT passing Cases A–D with low manual correction count. | In progress (`#13`) | **Hold** — offline & browser UAT passed; awaiting `GEMINI_API_KEY` for live 63-case evals & multimodal UAT |
| **v0.6** | Private pilot readiness: category-specific vendor comparisons, backend persistence & partner sharing | Couples can compare vendors using structured inclusions; time to correct vendor comparison measured in pilot; partner workspace sync; cost per accepted quote tracked. | Planned | Not started |
| **v0.7+** | Expanded vendor categories, Google Places autocomplete, payment/event UX refinements | Informed by private pilot telemetry, correction rates, and unit economics. | Planned | Not started |

---

## UX & Unit-Economics Metrics Tracked Per Release

| Metric | Target / Guardrail | Source |
|---|---|---|
| Critical financial errors (live evals) | **0** (release blocker) | `npm run eval -- --provider gemini` |
| Unsupported currency guesses (live evals) | **0** (release blocker) | `npm run eval -- --provider gemini` |
| Missed mandatory charges / false positives | Tracked per split in eval failure analysis | [EVAL_REPORT.md](EVAL_REPORT.md) |
| Human correction rate (fields edited per quote) | Downward trend across milestones | `src/telemetry.ts` & UAT logs |
| Time to a correct vendor comparison | Measured during browser UAT / pilot | Manual & browser UAT notes |
| Comprehension without rereading original quote | Verified for pricing, inclusions, missing info & payment terms | Browser UAT checklist |
| Cost per successful extraction / accepted quote | Recorded per live model version; informs pilot unit economics | `src/telemetry.ts` & `src/eval.ts` |

*Baseline reference (`v0.3`, `gemini-3.5-flash-lite`, 60 cases): `$0.01683` total estimated paid cost across 60 extractions (~`$0.00028` per extraction), ~`1.90s` avg latency, `59/60` (`98.3%`) live end-to-end accuracy, `0` critical financial errors. Cost per accepted quote will be populated once live `v0.5` UAT telemetry is collected.*

---

## Versioned Decision Log

Record significant product, architecture, and model decisions here as they are made. Keep entries factual and concise.

### D-001 — Separate AI Fact Extraction from Deterministic Financial Calculation (`v0.3`, Shipped)
- **Hypothesis:** Separating LLM fact extraction from deterministic TypeScript calculation prevents arithmetic hallucinations, double-counting, and currency guessing.
- **Change:** Built `src/extractor.ts` (structured JSON schema) + `src/validator.ts` (verbatim source grounding) + `src/calculator.ts` (pure math) + 60-case eval suite (`eval-data/`).
- **Evidence:** Live `gemini-3.5-flash-lite` improved from `2/6` (`33.3%`, 3 blockers) on initial held-out baseline to `59/60` (`98.3%`, 0 critical financial errors, 0 currency guesses, `$0.01683` est. cost) — see [EVAL_REPORT.md](EVAL_REPORT.md).
- **Trade-offs:** Slightly stricter schema & prompt maintenance in exchange for deterministic auditability.
- **Decision:** **Shipped** (`#11`).

### D-002 — Integrate Interactive Frontend Prototype in Mock Mode Before Live Wiring (`v0.4`, Shipped)
- **Hypothesis:** Validating the full wedding workspace UX and financial safeguards (booking eligibility, draft isolation, unpaid-by-default deposits) in mock mode first reduces integration risk.
- **Change:** Imported React/Vite prototype into `frontend/` with centralized `getVendorBookingEligibility`, `draftVendorMetadata`, unpaid-by-default deposits, and 6 regression tests (`#12`).
- **Failures & Fixes:** Codex review caught competing-vendor double-counting, unpersisted reviewed metadata, and a status-dropdown bypass of booking confirmation; all fixed and regression-tested before merge.
- **Trade-offs:** Temporary duplication between `src/calculator.ts` and `frontend/src/engine/financialCalculator.ts`, mitigated by parity fixtures in `v0.5`.
- **Decision:** **Shipped** (`#12`).

### D-003 — Real Multimodal Quote Import & Progressive-Disclosure Review (`v0.5`, On Hold Pending Live Verification)
- **Hypothesis:** Connecting `frontend/` to real server-side Gemini multimodal extraction (text, images, PDFs) with structured percentage bases, structured inclusions, negotiated-savings handling, and progressive-disclosure review will cut manual quote-entry friction while preserving all `v0.4` safeguards.
- **Change:** Implemented in PR `#13` (`feat/v0.5-real-quote-import`) with offline parity tests (`46/46` backend, `10/10` frontend, `63/63` mock evals) and Codex P2 fixes (add-on pricing models, conditional overtime, confirmed fees in whole-subtotal percentage bases).
- **Browser E2E UAT (Nov 26, 2026, `http://localhost:3000/`, no `GEMINI_API_KEY`):** Passed all 6 automated browser checks with **0 console errors**:
  - Time/clicks to vendor comparison: **2 clicks** (`Vendors` → `Compare`, ~1s); break-even, capacity, minimum guests, and unconfirmed fee caveats clearly understood without rereading source quotes.
  - Verdi draft & blocker enforcement: `Incomplete estimate` badge, approval blocked, `Save as Draft` kept projected spend at `$96,177`, booking disabled (`Resolve blockers`) across drawer, directory, and comparison.
  - Crown conflict & cash HST: conflict (`$5,400` DM vs `$6,000` PDF) blocked approval until selected; `$200` cash option preserved 13% HST (`$702.00` on `$5,400`).
  - Error recovery: pasting Case B text without `GEMINI_API_KEY` returned HTTP 502 from backend, showed red error banner + `Retry` button, preserved pasted text, and did not fall back to mock.
  - Booking & unpaid-by-default deposit: Versailles deposit (`$6,000`) unchecked by default; after booking, `Paid to date` stayed `$8,000`, `Booking Deposit` (`$6,000`) + `Final Balance` (`$29,798.40`) reconciled to `$35,798.40`.
  - Minor UX issues observed during browser UAT: fixed mobile bottom nav (`< 1024px`) overlaps the bottom row in `PaymentsView` (`Paid history`), and Verdi's resolution input placeholder (`"Confirmed amoun..."`) truncates slightly.
- **Remaining Risks / Failures to Verify:** Live 63-case Gemini evals (accuracy, latency, tokens, cost per extraction) and live two-image/PDF multimodal UAT are blocked until `GEMINI_API_KEY` is configured in the server environment.
- **Decision:** **Hold** — do not merge PR `#13` until live Gemini evals and live multimodal browser UAT pass PM release gates.

### D-004 — Reusable Antigravity Development Framework (`v0.4.x`, Shipped)
- **Hypothesis:** Codifying persistent project rules (`AGENTS.md`), 4 progressive-disclosure workflow skills (`.agents/skills/`), and a living roadmap/decision log will enforce financial safeguards, evaluation rigor, and independent review consistently across future milestones.
- **Change:** Added `AGENTS.md`, `.agents/skills/vowly-{feature-dev,ai-eval,release-validation,docs-sync}/SKILL.md`, `docs/ROADMAP.md`, and updated `.github/pull_request_template.md`.
- **Evidence:** Passed Codex review with 0 findings; merged via PR `#14` (`88abe8a`).
- **Trade-offs:** Lightweight Markdown rules/skills only—no custom hooks or MCP overhead.
- **Decision:** **Shipped** (`#14`).
