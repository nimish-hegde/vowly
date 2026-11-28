# Vowly Roadmap & Decision Log

**Last updated:** November 27, 2026  
**Related docs:** [Product spec](PRODUCT_SPEC.md) · [AI eval report](EVAL_REPORT.md) · [Changelog](../CHANGELOG.md) · [Agent instructions](../AGENTS.md)

This document is the single living tracker for Vowly milestones, PM-owned acceptance criteria, unit-economics observations, and versioned ship/hold decisions. Avoid duplicating detailed benchmark tables from [EVAL_REPORT.md](EVAL_REPORT.md) or release bullet points from [CHANGELOG.md](../CHANGELOG.md); link to them instead.

---

## Living Milestone & Acceptance-Criteria Tracker (Nov 27, 2026)

| Milestone | Scope | Measurable Acceptance Criteria (PM Gate) | Status | Ship / Hold |
|---|---|---|---|---|
| **v0.2 / v0.2.1** | Product definition & static concepts | PRD aligned with pilot scope, vendor/task statuses defined, privacy rules documented. | Done (`#6`) | Shipped |
| **v0.3** | AI quote extraction pipeline, 60-case eval harness, local Quote Review UI & telemetry | ≥95% live e2e accuracy on 60-case suite; **0 critical financial errors**; **0 unsupported currency guesses**; explicit human approval gate before budget mutation. | Done (`#8`, `#10`, `#11`) | Shipped (`59/60` live + overtime fix verified offline) |
| **v0.4** | Interactive React frontend prototype (`frontend/`, mock mode) & financial safeguards | Production build + type-check pass; centralized booking eligibility across all entry points; draft revision isolation; unpaid-by-default deposits; 0 secrets/personal data. | Done (`#12`) | Shipped |
| **v0.4.x (Framework)** | Reusable Antigravity development framework (`AGENTS.md`, 4 workflow skills, roadmap/decision log, PR template) | Persistent rules cover architecture, financial safeguards, eval standards, UX metrics, agent orchestration, and PM gates; zero application code changes. | Done (`#14`) | Shipped |
| **v0.5** | Real multimodal AI quote import & progressive-disclosure quote review | Real Gemini text/image/PDF extraction via server-side API; mutually exclusive packages & package-scoped terms; conditional overtime & extra-guest thresholds; unknown tax booking gate; manual editing with revision history; live Gemini evals with **0 critical financial errors** and **0 currency guesses**; browser E2E UAT passing. | Done (`#13`) | **Shipped** (`a0b942c`) — `53/53` backend, `17/17` frontend, `66/66` mock & `66/66` live Gemini (`0` blockers) |
| **v0.6** | Private pilot readiness: multimodal holdout & model benchmark (`#15`), shared deterministic financial engine (`#16`), extraction accuracy (`#21`), category-aware comparison (`#17`), follow-up delegation (`#4`), backend persistence & partner collaboration (`#20`, `#5`) | Shared backend/frontend deterministic engine (`30/30` parity); frozen 30-case multimodal benchmark; `0` critical financial errors on live evals; category-aware vendor & package comparison; auth, persistence, and helper-link delegation (`#4`, `#5`). | **In Progress** (`#15`, `#16` & `#21` shipped; `#17` pending review; `#18`–`#20`, `#4`, `#5` planned) | In progress |
| **v0.7+** | Vendor/event/budget UX polish & scale | Vendor archiving & duplicate management (`#18`), event/budget setup improvements (`#19`), Google Places autocomplete, and multi-installment booking schedules. | Planned | Not started |

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
- **Closed / Shipped:** `#1` (pre-approval quote revision review, partial updates, coupled-field confirmation gates, and replay protection shipped via `#26`), `#3` (venue comparison & `$500` break-even regression verified and closed on `85e00a9`), `#15` (30-case multimodal holdout & Gemini model benchmark shipped via `#22`, `b76c67c`), `#16` (shared deterministic financial engine shipped via `#23`, `a9b89c0`), `#17` (category-aware vendor & package comparison shipped via `#25`, `4dda164`), `#21` (extraction accuracy for cross-channel pricing-model conflicts, explicit tax/gratuity rates & bases, and ambiguous categories shipped via `#24`, `8f46c9a`).
- **Closed / Shipped:** `#7` shipped in [PR #27](https://github.com/nimish-hegde/vowly/pull/27). Scratch onboarding offers CAD and USD with CAD preselected. After extraction fails, users can save an incomplete manual quote with its original source.
- **Deferred to `v0.6` pilot readiness:** `#4` (assigning open questions from quote + scoped helper link without budget access + helper-submitted price review) and `#5` (5-couple moderated pilot study).

### Tracked Follow-Up Workstreams
1. **Model benchmarking & fresh multimodal holdout dataset (`#15`, Shipped via `#22`):** Frozen 30-case synthetic multimodal holdout (`eval-data/held-out-v3-multimodal/`) and 10-dimension benchmark harness shipped; PM approved retaining `gemini-3.5-flash-lite` as default.
2. **Shared deterministic financial engine (`#16`, Shipped via `#23`):** Consolidated calculation logic into `shared/finance/calculator.ts` with `30/30` frozen multimodal parity (including `I04` multi-package conditional overtime).
3. **Extraction accuracy follow-up (`#21`, Shipped via `#24`):** Cross-channel pricing-model conflicts, explicit tax/gratuity rates & bases, and ambiguous vendor categories improved on `gemini-3.5-flash-lite` (`29/30` strict all-in multimodal, `0` critical financial errors across all 100 live cases).
4. **Category-aware vendor & package comparison (`#17`, Pending review for `v0.6`):** Extend `VendorComparisonView` beyond venues to compare any vendor category (photography, catering, DJ, decor) using structured inclusions, delivery terms, and side-by-side mutually exclusive package tiers within a vendor.
5. **Vendor archiving & duplicate management (`#18`, Planned for `v0.6+`):** Allow archiving declined/superseded vendors, merging or linking duplicate vendor records, and surfacing duplicate-revision idempotency checks.
6. **Event & budget setup improvements (`#19`, Planned for `v0.6+`):** Add multi-installment (`>2` milestones) custom payment schedules in `BookingModal`. Currency selection and manual quote recovery shipped under `#7`.
7. **Authentication, persistence & partner collaboration (`#20`, Planned for `v0.6`):** Replace `localStorage`-only persistence with authenticated backend storage, multi-device partner sync, and scoped helper task links (`#4`, `#5`).

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

### D-007 — Issue #15 Gemini Model Benchmarking & Fresh 30-Case Multimodal Holdout (`experiment/model-benchmarking`)

- **Hypothesis:** Newer Gemini models (`gemini-3.8-flash`, `gemini-4-hydrogen`, `gemini-4-neon`) might meaningfully improve multimodal quote extraction accuracy or reduce manual corrections compared to `gemini-3.5-flash-lite`.
- **Changes:**
  - Created frozen, 100% synthetic 30-case multimodal holdout (`eval-data/held-out-v3-multimodal/`: `10` pasted messages, `10` PNG screenshots, `10` single/multi-page PDFs) with deterministic generator (`scripts/generate-multimodal-holdout.ts`, `scripts/render-holdout-images.ps1`).
  - Built 10-dimension benchmark runner (`scripts/run-model-benchmark.ts`) with true multimodal `documentText` grounding, 3-way separation (AI extraction errors vs. legitimate user decisions vs. missing source info), and frontend/backend calculation parity checks; added `--model` flag to `src/eval.ts` and updated model pricing table in `src/telemetry.ts`.
  - Kept default production model (`gemini-flash-lite-latest`), `SYSTEM_PROMPT`, `GEMINI_RESPONSE_SCHEMA`, and all 66 locked regression cases unchanged.
- **Evaluation Results (`$0` actual spend on free tier):**
  - **Smoke tests:** `gemini-3.5-flash-lite` PASS (`1.66s`); `gemini-4-hydrogen` PASS (`43.6s`, thinking-enabled); `gemini-3.8-flash` EXCLUDED (persistent HTTP `503 UNAVAILABLE` / timeouts); `gemini-4-neon` EXCLUDED (HTTP `429` free-tier unavailable; billing not enabled).
  - **`gemini-3.5-flash-lite` (30/30 full + 15 consistency runs):** `28/30 (93.3%)` subtotal-based E2E (`10/10` image, `10/10` PDF, `8/10` text) with **1 critical subtotal error (`T07`)**, and **`22/30 (73.3%)`** under post-Codex strict all-in financial grading (`6` multimodal cases omitted explicit `taxPercent`/`gratuityPercent`/`gratuityBasis` as `undefined`), `94.1%` field accuracy, `0.70` AI corrections/quote, `2,570 ms` avg no-retry latency, `$0.00316` est. paid cost/extraction (`$0.30/$2.50` per 1M); `12/15` subtotal-based (`9/15` strict all-in) on 5-case × 3-repeat consistency check; `66/66` locked regression intact.
  - **`gemini-4-hydrogen` (smaller, non-equivalent subset: 12 attempted / 8 completed before free-tier `429`/`503` circuit breaker):** `7/8` completed (`98.4%` field accuracy, `0.38` AI corrections/quote), but **failed `T07` too**, `12,221 ms` avg no-retry latency (`4.8×` slower), and `$0.03057` est. paid cost/extraction (`9.7×` more expensive due to `14,599` default thinking tokens). Free-tier throttling (`429`/`503`) is **not** evidence of paid-tier reliability.
  - **Follow-ups Tracked (frozen `held-out-v3-multimodal` preserved without tuning):** Unresolved `I04` frontend/backend calculation parity gap tracked under **Issue #16**; `T07` and `T10` extraction improvements tracked under **Issue #21**.
- **Decision:** **Approved by PM — Retain `gemini-3.5-flash-lite` (`gemini-flash-lite-latest`) as the current default and defer model migration.**

### D-008 — Issue #16 shared quote pricing

- **Hypothesis:** Resolving package selection and scenario inputs in a shared engine prevents pricing drift between backend review and the workspace.
- **Migration:** Characterized both calculators on `b76c67c`, replaced backend arithmetic behind its existing entry point, then switched the workspace entry point to the same module. The contract separates quote and package facts from guest counts, selected package, requested duration, and confirmed edits. The result includes line amounts, billable quantities, totals, completeness, and financial blocker codes. Both adapters retain their public return shapes. Budget aggregation, booking, and payments keep their current owners.
- **Intentional corrections:** Calculate shared overtime from the selected tier's included hours. I04 Full Collection totals CAD 3,100 before tax at eight hours, with zero overtime. Validate current financial and source blockers when approving. Require source acknowledgement and exact-cent reconciliation of new installments plus existing paid milestones when booking.
- **Saved workspaces:** Keep the v1 storage key. An ambiguous historical one-hour default retains its prior amount until explicitly confirmed or corrected. Confirmed contract amounts and paid milestones govern booked costs.
- **Acceptance evidence:** Both calculation paths agree on all 30 frozen mock inputs. The 66-case offline suite and both test suites pass. The v1 demo workspace preserves projected, committed, and paid totals after serialization. Local Chrome verified I04 import, tier selection, overtime edits, and draft persistence. [Verification details](EVAL_REPORT.md#15-issue-16-deterministic-financial-parity)
- **Decision:** **Shipped (`#23`, `a9b89c0`).** Issue #21 tracks the separate extraction findings.

### D-009 — Issue #21 Extraction Accuracy Follow-Up (`fix/issue-21-extraction-accuracy`)

- **Hypothesis:** Requiring nullable `taxPercent`/`gratuityPercent`/`gratuityBasis` in `GEMINI_RESPONSE_SCHEMA`, tightening `SYSTEM_PROMPT` Rules 4, 5, 7, 9, and 11 (ambiguous hospitality categories, footer/multi-page tax & gratuity scanning without fabrication, non-authoritative cross-channel pricing-model conflicts with verbatim open-question excerpts), and hardening deterministic conflict/single-package normalization will substantially improve `gemini-3.5-flash-lite` strict all-in multimodal accuracy without changing the default model or tuning against frozen holdouts.
- **Changes:**
  - `src/extractor.ts`: Added nullable `taxPercent`, `gratuityPercent`, and `gratuityBasis` to `GEMINI_RESPONSE_SCHEMA.required`; tightened `SYSTEM_PROMPT` Rules 4, 5, 7, 9, 11; added deterministic normalizer guard aligning mismatched provisional `pricingType` to its matching `conflictingOptions` entry and preserving explicit multi-package `null` overrides.
  - `src/eval.ts` & `scripts/run-model-benchmark.ts`: Added optional `taxPercent`/`gratuityStatus`/`gratuityPercent`/`gratuityBasis` checks on `EvalCase`; updated conflict subtotal grading so neither conflicting option is treated as authoritative when `conflictingOptions` preserves both options and exact discrepancy (while keeping double-counting and undetected conflicts as critical financial errors).
  - `eval-data/dev/cases.json`: Added 4 independent synthetic `dev-issue21-*` cases covering all 3 categories + unstated-tax no-hallucination guardrail; frozen `held-out-v3-multimodal/` and all 66 original locked cases remained untouched.
- **Live Verification (`gemini-3.5-flash-lite`, `$0` actual spend on free tier):**
  - **Frozen 30-case multimodal holdout (`held-out-v3-multimodal`, strict all-in grading):** Improved from **`22/30` (`73.3%`, `7` critical financial errors)** to **`29/30` (`96.7%`, `0` critical financial errors, `0` currency guesses)**; field accuracy `99.1%` (`218/220`), FE/BE parity `30/30` (`100%`), AI corrections/quote dropped `52%` (`0.70` → `0.33`), true local-span grounding `89/95` (`93.7%`), avg no-retry latency `2,555 ms`, est. paid cost `$0.08988` (`$0.00310`/extraction). Only remaining failure: `P07` (`quoteKind: revision` vs `initial`, `0` financial errors).
  - **Legacy suite (reported separately):** Original 66 cases **`63/66` (`95.5%`, `0` critical financial errors, `0` currency guesses, `0` release blockers)**; new 4 `dev-issue21-*` cases **`4/4` (`100.0%`)**; combined `67/70` (`95.7%`), avg no-retry latency `1,989 ms` (`3` retries), est. paid cost `$0.17356` (`$0.00259`/extraction). Remaining 3 non-blocking failures documented honestly (`dev-uat-case-a-missing-gratuity` `category`, `venue-conflict-brochure-vs-note` `quoteKind`, and `heldout2-catering-unpriced-dish-surcharge` missed `"goat biryani"` conditional fee).
- **Known Residual Risk (Conditional Surcharge Extraction):** Unpriced conditional menu/dish surcharges (e.g., `"rate on request"` in `heldout2-catering-unpriced-dish-surcharge`) can exhibit stochastic omission on `gemini-3.5-flash-lite`: if the model omits the item from `lineItems`, the UI has no `unconfirmedFees` blocker and would present the estimate as complete unless caught during manual quote review (targeted replay extracted the item cleanly and blocked approval/booking as intended). Monitor via review telemetry and human correction rate in pilot UAT.
- **Decision:** **Approved by PM and shipped (`#24`).** [Verification details](EVAL_REPORT.md#16-issue-21-extraction-accuracy-follow-up)

### D-010 — Issue #17 vendor and package comparison

- **Hypothesis:** Comparing scoped prices and terms at the same event and scenario helps couples identify the differences that could change their decision.
- **Changes:** Vendors → Compare uses the existing quote models and shared financial engine. Compare two or more vendors in the same category or alternate tiers in one quote. Show base prices, extras, gratuity, tax, estimate completeness, scoped terms, and available evidence. Confirmed contracts remain distinct. The phone layout keeps two alternatives aligned and lets users swap them.
- **Saved state:** Scenario inputs are local to comparison. Opening the source editor keeps them in place. A saved correction can refresh the estimate through the existing review flow. Attendance, package selection, preferred vendors, and confirmed payments remain governed by their existing workflows.
- **Offline verification:** On baseline `8f46c9a`, all 66 backend tests, 25 frontend tests, 70 mock evals, and 33 frozen parity tests passed. The initial PR passed 66 backend tests, 37 frontend tests, all 70 mock cases, 30/30 frozen multimodal parity cases (33 tests), frontend type-check, and production build. Added 12 tests, including the CAD 500 venue break-even, I04 coverage, and synthetic DJ and decor cases. No extraction changes or live calls.
- **Browser verification:** Local Chrome at 1440 px and 360 px exercised all five categories, synthetic DJ and decor tiers, photography overtime, source expansion and quote-editor return, mobile column swaps, and saved-state isolation. A synthetic catering rate correction refreshed the price while preserving the test count. The desktop venue scenario rendered in about 0.32 s in the automated run. PM manual UAT passed photography overtime, venue package comparison, source editing, missing information, and mobile. Participant comprehension and timing remain for pilot UAT.
- **PR #25 follow-up:** Separately itemized overtime, AV, and staffing appear under extras across categories. The comparison reuses the existing calculated amounts and keeps workspace state unchanged. Hourly-only offers with a saved duration respond to hypothetical hours. The follow-up passes 39 frontend tests, 66 backend tests, 70 mock evals, 30/30 frozen multimodal parity cases, type-check, and build.
- **Future improvements:** Improve classification of bundled venue and catering charges when quotes do not itemize them. Make key-difference banners name the specific fee or term that differs.
- **Decision:** Hold for explicit PM merge approval.

### D-011 — Issue #1 pre-approval quote revision review

- **Hypothesis:** Comparing the proposed revision with an approved quote helps couples verify changes without losing omitted charges or changing a confirmed contract.
- **Changes:** The existing quote modal shows previous and proposed values, scoped changes, source excerpts, and choices to retain or accept values, match ambiguous charges, or enter confirmed amounts. Drafts store their reviewed baseline and decisions. The shared financial engine prices the snapshots and previews the workspace impact where calculable. Approval appends a dated record with the changed fields and available evidence.
- **Safeguards:** Carry omitted fees and sibling tiers forward. Reject mixed-currency partial pricing and stale approvals. Replayed revisions are no-ops. Approved quote revisions keep saved contract commitments and payment records intact. A legacy booked record without a confirmed amount requires confirmation before approval.
- **Scoped Automation Decision (Private Pilot):** Automatically reconcile only unambiguous, uncoupled partial changes (e.g., exact-matched line-item price drops, unconfirmed fee updates, inherited child defaults). Coupled or ambiguous financial amendments—such as quote-wide tax, gratuity, guest minimum, coverage-hour, or payment updates against retained package overrides, tax lines, or gratuity/service-charge lines—block approval until the user explicitly confirms (`Accept proposed value` or `Retain previous value`), resolving the underlying conflicting fields and recalculating via the shared financial engine rather than silently inferring precedence.
- **Independent Review & Verification:** Completed 5 rounds of Codex review (all 15 findings resolved) plus an internal independent adversarial review (`6` additional findings fixed and bounded-validated on `045eaa0` after external Codex review became unavailable). Final offline suite: `156` frontend tests (including table-driven revision matrix tests), `66` backend tests, `70/70` mock evals (`0` critical financial errors, `0` currency guesses, `0` blockers), `30/30` frozen multimodal parity cases (`33` tests), `0` TypeScript errors, and clean Vite build.
- **Browser verification:** Local Chrome UAT verified desktop (`1440 px`) and mobile (`360 px`) flows plus targeted add-on selection/deselection, package-fee conflict resolution (`$1,300 → $1,600`), simple uncoupled AV reduction (`$452` all-in savings), and complex coupled quote-wide tax override confirmation (`$1,130 → $1,000`) with `0` console errors using local fixture responses (no live extraction).
- **Remaining Limitations:** Complex coupled partial amendments require explicit reviewer confirmation rather than full automatic merging; browser UAT used deterministic local fixtures rather than live Gemini calls; external Codex review could not run on the final commit (`045eaa0`) and was substituted with internal independent adversarial review and bounded validation.
- **Decision:** **Approved by PM and shipped (`#26`, Issue `#1` closed).**

### D-012 — Issue #7 onboarding currency and manual quote recovery

- **Hypothesis:** A currency choice in the existing form and a source-preserving manual fallback help couples finish setup even when extraction fails.
- **Changes:** Scratch onboarding offers CAD and USD with CAD preselected. Manual recovery reuses quote review and editing, retains the original text or attachment, and allows incomplete drafts. Existing approval gates block mixed-currency partial revisions. If browser storage is full, the unsaved source stays open in review for retry.
- **Verification:** Four focused checks passed, along with 66 backend tests, 159 frontend tests, 70 offline mock cases, 33 financial parity tests, type-check, and production build. Local desktop and mobile Chrome verified currency persistence, preservation of an existing workspace, and text, PNG, and PDF recovery with simulated extraction failures. Live API calls totaled zero.
- **Decision:** PM approved [PR #27](https://github.com/nimish-hegde/vowly/pull/27) after Codex review returned zero findings. The PR shipped in [`1d338f1`](https://github.com/nimish-hegde/vowly/commit/1d338f1e516ae888244e0a541d664a064c34bbc9), and Issue #7 closed as completed.
