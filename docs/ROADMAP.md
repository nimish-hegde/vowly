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
| **v0.5** | Real multimodal AI quote import & progressive-disclosure quote review | Real Gemini text/image/PDF extraction via server-side API; mutually exclusive packages & package-scoped terms; conditional overtime & extra-guest thresholds; unknown tax booking gate; manual editing with revision history; live Gemini evals with **0 critical financial errors** and **0 currency guesses**; browser E2E UAT passing. | Done (`#13`) | **Shipped** (`a0b942c`) — `53/53` backend, `17/17` frontend, `66/66` mock & `66/66` live Gemini (`0` blockers) |
| **v0.6** | Private pilot readiness: shared financial engine, category-aware comparison, follow-up delegation, backend persistence & partner collaboration | Shared backend/frontend deterministic engine; category-aware vendor & package comparison; fresh multimodal holdout & model benchmarking; auth, persistence, and helper-link delegation (`#4`, `#5`). | Planned | Not started |
| **v0.7+** | Vendor/event/budget UX polish & scale | Vendor archiving & duplicate management, event/budget setup improvements, Google Places autocomplete, and multi-installment booking schedules. | Planned | Not started |

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

*Baseline reference (`v0.3`, `gemini-3.5-flash-lite`, 60 cases): `$0.01683` total estimated paid cost across 60 extractions (~`$0.00028` per extraction), ~`1.90s` avg latency, `59/60` (`98.3%`) live end-to-end accuracy, `0` critical financial errors. Latest `v0.5` (`a0b942c`, 66 cases): `66/66 (100.0%)`, `0` critical financial errors, `1,775 ms` avg latency excl. retries, `$0.03101` est. paid cost (~`$0.000470` per extraction).*

---

## Post-v0.5 Follow-Up Backlog (Audited Against `main` `a0b942c`)

### Open Issue Audit Status
- **Close candidate:** `#3` (venue comparison, hypothetical attendance, minimums, capacity flags, and break-even callout implemented; category/package comparison enhancements tracked below).
- **Partially complete (targeted gaps remain):** `#1` (pre-approval revision diff preview & duplicate-revision idempotency) and `#7` (scratch-onboarding currency selector & `"Continue with manual entry"` fallback on extraction failure).
- **Deferred to `v0.6` pilot readiness:** `#4` (assigning open questions from quote + scoped helper link without budget access + helper-submitted price review) and `#5` (5-couple moderated pilot study).

### Tracked Follow-Up Workstreams
1. **Model benchmarking & fresh multimodal holdout dataset (`v0.6`):** Build a new versioned multimodal holdout split (real-pattern screenshots & PDFs across multi-package venues, photography, decor, and catering) without modifying locked `regression/`, `held-out/`, or `held-out-v2/` sets, and benchmark candidate Gemini/local models on accuracy, latency, and cost per accepted quote.
2. **Shared deterministic financial engine (`v0.6`):** Consolidate `src/calculator.ts` and `frontend/src/engine/financialCalculator.ts` into a single shared TypeScript calculation module so backend and frontend share one source of truth instead of parity fixtures alone.
3. **Category-aware vendor & package comparison (`v0.6`):** Extend `VendorComparisonView` beyond venues to compare any vendor category (photography, catering, DJ, decor) using structured inclusions, delivery terms, and side-by-side mutually exclusive package tiers within a vendor.
4. **Vendor archiving & duplicate management (`v0.6+`):** Allow archiving declined/superseded vendors, merging or linking duplicate vendor records, and surfacing duplicate-revision idempotency checks.
5. **Event & budget setup improvements (`v0.6+`):** Add currency selection in scratch onboarding (`#7`), `"Continue with manual entry"` fallback when AI extraction fails (`#7`), and multi-installment (`>2` milestones) custom payment schedules in `BookingModal`.
6. **Authentication, persistence & partner collaboration (`v0.6`):** Replace `localStorage`-only persistence with authenticated backend storage, multi-device partner sync, and scoped helper task links (`#4`, `#5`).

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

### D-003 — Real Multimodal Quote Import & Progressive-Disclosure Review (`v0.5`, Pending Manual UAT & PM Approval)
- **Hypothesis:** Connecting `frontend/` to real server-side Gemini multimodal extraction (text, images, PDFs) with structured percentage bases, structured inclusions, negotiated-savings handling, and progressive-disclosure review will cut manual quote-entry friction while preserving all `v0.4` safeguards.
- **Change:** Implemented in PR `#13` (`feat/v0.5-real-quote-import`) with offline parity tests (`47/47` backend, `10/10` frontend, `63/63` mock evals), Codex P2 fixes (add-on pricing models, conditional overtime, confirmed fees in whole-subtotal percentage bases), and live eval fixes (`src/extractor.ts` prompt/schema + `src/calculator.ts`/`frontend/src/engine/financialCalculator.ts` service-charge deduplication).
- **Live Gemini Benchmark & Multimodal Results (`gemini-3.5-flash-lite`, Nov 26, 2026):**
  - Initial live run scored `55/63` (`2` critical financial errors: duplicate `15%` service-charge line item and `maxCapacity` copied to `minGuests`); post-fix live rerun achieved **`63/63 (100.0%)`** (`60/60` on the original cases vs `59/60` in `v0.3`, **`3/3`** on new UAT Cases A–C, **`0` critical financial errors**, **`0` release blockers**, `2,417 ms` avg latency incl. retries / `1,749 ms` excl. retries, `146,170` in / `25,536` out tokens, `$0.02483` est. paid cost = `$0.000394` per extraction) — see [EVAL_REPORT.md](EVAL_REPORT.md).
  - Live multimodal tests (`quote_venue.png`, `quote_photo.png`, `quote_decor.pdf`): **`3/3` passed** with valid schemas, distinct grounded `pageReference` citations, and verified deterministic calculations (`$16,509.30` all-in venue, `$300` negotiated photo savings, TBD decor lighting fee preserved).
- **Browser E2E UAT (Nov 26, 2026, `http://localhost:3000/`):** Passed all 6 automated browser checks with **0 console errors** (`2` clicks / ~1s to vendor comparison; Verdi draft/blockers, Crown conflict + cash HST, live error recovery without mock fallback, and Versailles unpaid-by-default deposit reconciliation verified; minor mobile bottom-nav overlap in `PaymentsView` and input placeholder truncation noted).
- **Decision:** **Hold** — live servers started for user manual UAT; do not merge PR `#13` until PM approves.

### D-004 — Reusable Antigravity Development Framework (`v0.4.x`, Shipped)
- **Hypothesis:** Codifying persistent project rules (`AGENTS.md`), 4 progressive-disclosure workflow skills (`.agents/skills/`), and a living roadmap/decision log will enforce financial safeguards, evaluation rigor, and independent review consistently across future milestones.
- **Change:** Added `AGENTS.md`, `.agents/skills/vowly-{feature-dev,ai-eval,release-validation,docs-sync}/SKILL.md`, `docs/ROADMAP.md`, and updated `.github/pull_request_template.md`.
- **Evidence:** Passed Codex review with 0 findings; merged via PR `#14` (`88abe8a`).
- **Trade-offs:** Lightweight Markdown rules/skills only—no custom hooks or MCP overhead.
- **Decision:** **Shipped** (`#14`).


### D-005 — Multi-Package Quotes, Conditional Charges, Honest Unknown Tax & Manual Quote Editing (PR #13 UAT Remediation)

- **Hypothesis:** Real-world vendor quotes frequently present mutually exclusive package tiers (e.g., Royal vs. Imperial), incremental extra-guest / overtime-hour rates, multi-shooter coverage durations, delivery turnaround terms, and unstated tax. Modeling packages as first-class mutually exclusive options with deterministic approval/booking gates, fixing conditional overtime & inclusion formatting, separating `'unspecified'` tax from `'tax_exempt'`, flagging buggy legacy quotes, and enabling manual editing of approved quotes with full revision history will eliminate the critical UAT financial errors without regressing the existing 63-case benchmark.
- **Changes:**
  - Backend (`src/types.ts`, `src/extractor.ts`, `src/validator.ts`, `src/calculator.ts`, `src/review.ts`, `src/eval.ts`): Added `PackageOption` (`packages[]`, `selectedPackageId`, package-scoped inclusions/tax/gratuity/delivery/fees), `per_extra_guest` with `guestThreshold` & redundant extra-guest deduplication, `durationHours` on inclusions, `deliveryTerms[]`, conditional overtime `hours <= 1` fix, and single-package normalization.
  - Frontend (`vowly.ts`, `financialCalculator.ts`, `quoteExtractor.ts`, `workspaceTransitions.ts`, `QuoteImportModal.tsx`, `VendorDetailDrawer.tsx`, `VendorsView.tsx`, `ImageLightboxModal.tsx`, `App.tsx`): Parity calculation for multi-package selection (blocks approval & booking until chosen, preserves all options), `'unspecified'` tax state (`"Tax not stated — excluded from estimate."`, allowed for projected budget as incomplete, blocks booking), legacy suspicious-quote re-review detection & booking block, full manual quote editing with version preservation & `QuoteRevisionRecord` (without touching booked obligations or paid milestones), stable vendor-name input, inclusion hygiene, and zoomable source image lightbox.
- **Evaluation Results:**
  - Offline: `50/50` backend tests, `66/66` mock evals, `13/13` frontend tests, `0` lint errors, clean Vite build.
  - Live (`gemini-3.5-flash-lite`): **66/66 (100.0%)** (`23/23 dev`, `6/6 regression`, `25/25 held-out`, `12/12 held-out-v2`), **0 critical financial errors**, **0 release blockers**, avg latency `1,796 ms` excl. retries (`2,798 ms` incl. 8 HTTP-429 retries), est. paid cost `$0.03062` (`$0.000464` / successful extraction).
- **Trade-offs:** Keeping `packages.items` lean in `GEMINI_RESPONSE_SCHEMA` (routing package-specific fees via `lineItems[].packageId`) avoided schema bloat and kept `gemini-3.5-flash-lite` latency under `1.8s` excl. retries.
- **Decision:** **Pending fresh Codex review, manual UAT, and explicit PM approval on PR #13 (do not merge yet).**


### D-006 — Final PR #13 Targeted Remediation (Codex Parity Findings, Conditional Hourly & Payment Schedule Propagation)

- **Hypothesis:** Unifying backend-to-frontend line-item/package-fee mapping, extending conditional overtime detection (`hourly` + `inclusions[].durationHours` + manual toggle), propagating explicit quote payment dates into `BookingModal` without hardcoded fallbacks, and reinforcing unstated-tax grounding will close all remaining PR #13 release blockers from Codex review and founder manual UAT.
- **Changes:**
  - Shared `mapBackendItem` helper in `frontend/src/services/quoteExtractor.ts` preserving unknown mandatory package fees (`unconfirmedFees` with `packageId`), unknown package prices (`unitPrice: null`, `unresolvedPackagePrice: true`), and full hourly/percentage calculation parameters on package fees.
  - Package-aware tax editing (`updateEffectiveTaxHandling`) and manual `"Conditional rate (0 hrs default)"` toggle in `QuoteImportModal.tsx`; `OVERTIME_PATTERN` + `durationHours` parity in `src/calculator.ts` and `quoteExtractor.ts`.
  - `normalizeIsoDate` and `deriveBookingScheduleDefaults` in `financialCalculator.ts` wired into `BookingModal.tsx` (explicit date -> relative deadline -> unresolved; zero hardcoded fallback dates; preserves existing `Paid` milestones in `applyConfirmBooking`).
  - Strengthened `SYSTEM_PROMPT` Rule 5 in `src/extractor.ts` to keep unmentioned tax as `unknown`.
- **Verification Results:**
  - Offline: `53/53` backend tests, `66/66` mock evals, `17/17` frontend tests, `0` TS errors, clean Vite build (all Codex P1/P2 findings resolved, including explicit null package gratuity preservation, conflicting price-option pricing models, order-independent percentage add-ons, and whole-subtotal gratuity parity across backend and frontend).
  - Live Gemini (`gemini-3.5-flash-lite`, 66 cases): **66/66 (100.0%)**, `0` critical financial errors, `0` release blockers, `1,775 ms` avg latency excl. retries (`2,859 ms` incl. retries), est. paid cost `$0.03101` (`$0.000470`/extraction); `3/3` targeted live checks re-verified (extraction prompt/schema unchanged).
  - Browser E2E UAT: Passed both HSR Photography (`$900` subtotal, unknown-tax booking block, `2027-08-13` balance due date) and Multi-Package Venue (Royal vs. Imperial isolation & package-scoped inclusions).
- **Deferred to Next Milestone (`v0.6` Non-Blocking Usability Improvements):**
  - Multi-installment (>2 milestones) custom payment schedule builder inside `BookingModal`.
  - Post-event actual overtime reconciliation workflow.
  - Side-by-side multi-package comparison inside `VendorComparisonView`.
  - Inline editing of package-specific fees/overrides without leaving the package card.
- **Decision:** **Approved by PM and merged (`#13`).**
