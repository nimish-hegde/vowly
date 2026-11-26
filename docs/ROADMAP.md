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
| **v0.4.x (Framework)** | Reusable Antigravity development framework (`AGENTS.md`, 4 workflow skills, roadmap/decision log, PR template) | Persistent rules cover architecture, financial safeguards, eval standards, UX metrics, agent orchestration, and PM gates; zero application code changes. | In review | Hold pending PM review |
| **v0.5** | Real multimodal AI quote import & progressive-disclosure quote review | Real Gemini text/image/PDF extraction via server-side API; structured percentage bases & inclusions; negotiated savings without false conflicts; live Gemini evals with **0 critical financial errors** and no regression vs. `v0.3`; live browser UAT passing Cases A–D with low manual correction count. | In progress (`#13`) | **Hold** pending live Gemini evals & browser UAT |
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
- **Remaining Risks / Failures to Verify:** Live Gemini accuracy, latency, token usage, cost per extraction, and real two-image multimodal UAT have not yet been run (awaiting `GEMINI_API_KEY` in environment).
- **Decision:** **Hold** — do not merge PR `#13` until live Gemini evals and browser UAT pass PM release gates.

### D-004 — Reusable Antigravity Development Framework (`v0.4.x`, In Review)
- **Hypothesis:** Codifying persistent project rules (`AGENTS.md`), 4 progressive-disclosure workflow skills (`.agents/skills/`), and a living roadmap/decision log will enforce financial safeguards, evaluation rigor, and independent review consistently across future milestones.
- **Change:** Added `AGENTS.md`, `.agents/skills/vowly-{feature-dev,ai-eval,release-validation,docs-sync}/SKILL.md`, `docs/ROADMAP.md`, and updated `.github/pull_request_template.md`.
- **Trade-offs:** Lightweight Markdown rules/skills only—no custom hooks or MCP overhead.
- **Decision:** **Pending PM review.**
