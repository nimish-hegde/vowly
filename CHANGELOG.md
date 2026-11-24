# Vowly changelog

## Unreleased

Follow the [pilot backlog](https://github.com/nimish-hegde/vowly/issues) for planned work. Add completed user-facing improvements here with a link to the PR and any measured result.

## November 23, 2026 — Regression fix, 45-case eval dataset, Quote Review UI & telemetry (`v0.3`, `#2`)

- Recorded the live Gemini Flash Lite regression rerun (**5/6 passed**, 0 critical financial errors, 0 unsupported currency guesses, 0 release blockers) in [the eval report](docs/EVAL_REPORT.md).
- Updated `src/extractor.ts` to generate actionable open questions for unspecified currency (`UNKNOWN`) and unresolved relative payment deadlines without adding noisy questions for complete quotes, and added `catering` and `entertainment` categories.
- Added live per-case progress and retry notices to `src/eval.ts`.
- Expanded the dataset with 25 new realistic cases (10 `dev`, 15 `held-out`, keeping the 6 `regression` cases untouched — 45 cases total).
- Added a local Quote Review UI (`npm run ui` via `src/server.ts`, `src/review.ts`, `ui/index.html`) so users can review line items beside source excerpts, edit values, resolve open questions, and explicitly approve quotes before updating their wedding budget.
- Added telemetry instrumentation (`src/telemetry.ts`) tracking extraction success rate, latency, tokens, estimated cost, user corrections by field, unresolved questions, and quote approval rate.
- Fixed three issues from code review of the review UI:
  - The budget no longer adds different currencies together. Approved totals are kept per currency (for example `CAD 8,000 + USD 1,000`), and a quote marked `UNKNOWN` currency can't be approved until the couple sets the currency.
  - If an extracted excerpt can't be found in the original message, the review screen now shows that excerpt in red and blocks approval until the couple confirms they checked it.
  - Failed extraction requests (API errors, bad JSON) now count in the UI's success rate, latency and retry numbers. Before, only successful calls were counted, so the success rate looked better than it was.
  - Quotes with unresolved mandatory TBD costs can no longer be approved into the committed budget until each TBD item is priced, marked included, or marked as an optional add-on.
- Recorded the first 45-case live baseline on `gemini-3.5-flash-lite` (`36/45` end-to-end, `44/45` API availability, `44/44` schema validity, `1` critical financial error, `0` currency guesses, `14` retries) in [the eval report](docs/EVAL_REPORT.md) and addressed all four failure patterns:
  - **P0 conflicting prices:** added `conflictingOptions` on `LineItem`, discrepancy calculation in `src/calculator.ts`, prompt/schema rules preventing double-counting, and conflict resolution in `src/review.ts`, `src/server.ts`, and `ui/index.html` (blocking budget approval until the couple picks which price applies).
  - **P1 venue vs. catering:** defined `venue` (provides the event space, even with bundled food) vs. `catering` (independent food service, even at a venue) and added `unknown` category with paired dev examples.
  - **P1 unpriced mandatory/conditional charges:** added `chargeType` (`mandatory` | `conditional` | `optional`) and general cross-category rules so unpriced mandatory and conditional charges stay non-optional, raise `missing_price` questions, and block approval.
  - **P2 provider reliability metrics:** separated API availability, schema validity, extraction accuracy (completed), end-to-end success, latency including retries, and latency excluding retries in `src/eval.ts`, and added `--show-raw`.
- Preserved the 6-case `regression` and 25-case `held-out` baselines untouched, expanded `dev` to 17 cases, and added a fresh 12-case `held-out-v2` split (`60` mock cases total).
- Recorded live verification of commit `65f1392` on `gemini-3.5-flash-lite` (**55/60 (91.7%)**, **6/6** regression, **25/25** original held-out, **60/60** API availability & schema validity, **0** critical financial errors, **~1.90s** avg latency, **`$0.01683`** est. paid cost) and fixed the remaining three gaps:
  - Added deterministic conflict normalization (`normalizeConflictingOptions`) so single-alternative `conflictingOptions` + primary `amount` are detected, deduplicated, and block approval identically to full-list `conflictingOptions`; undetected price conflicts now count as release blockers.
  - Tightened `venue` vs. `unknown` classification so dinner packages, per-person pricing, setup fees, or minimum guest counts alone require explicit physical-space evidence rather than defaulting to `venue`.
  - Added strict CLI parsing (`--provider gemini|ollama|mock`) to `src/eval.ts` so unsupported flags fail loudly and explicitly requested live runs never silently fall back to `mock`.
- Unit tests: `37/37` passing offline. Mock evals: `60/60`.

## November 23, 2026 — Live Gemini eval baseline and extraction reliability (`v0.3`, `#2`)

- Ran the first live quote-extraction tests on Windows using the Gemini free tier (`gemini-flash-lite-latest`): **4/4** on dev after prompt cleanup, **2/6 (33.3%)** on the original held-out split with 3 release blockers.
- Documented the real failures and fixes in [the eval report](docs/EVAL_REPORT.md): a $495 bartender ratio undercount, a guessed `CAD` currency on bare `$`, dropped `openQuestions` arrays, a misclassified negotiated quote, and HTTP 503 crashes.
- Updated `src/extractor.ts` to use Gemini's native `responseSchema`, a cleaned-up prompt, bounded retries (`429`/`502`/`503`/`504` with `Retry-After` and 30s timeout), and `modelVersion` + token tracking.
- Added runtime schema and source-passage validation (`src/validator.ts`), equivalent vendor term normalization, and unit tests covering calculator, validator, extractor, and grader edge cases (`17/17` passing).
- Moved the original 6 held-out quotes to `eval-data/regression/cases.json` and added 10 fresh untouched quotes in `eval-data/held-out/cases.json` (20 cases total, sized for the Gemini free tier). Live re-evaluation is pending before closing `#2`.

## November 23, 2026 — PRD cleanup and pilot backlog check (v0.2.1)

- Merged the two duplicate pilot evaluation sections in [the product spec](docs/PRODUCT_SPEC.md) into one section.
- Narrowed the private alpha (`v0.5`) to the venue quote loop (capture, compare, revise, assign follow-up) and pushed booking/payment tracking and photographer UI to `v0.6+` so the spec matches the backlog.
- Spelled out vendor/task statuses, what helpers can see, and keeping real couples' quotes private.
- Linked issues `#1`–`#5` and `#7` to milestones `v0.3`–`v0.6` and recorded the TypeScript + Gemini choice.

## November 21, 2026 — Vowly prototype branding

- Updated the wordmark in all three [design concepts](docs/PRODUCT_SPEC.md).

## November 21, 2026 — Product definition (PRD v0.2)

- Published the [pilot requirements](docs/PRODUCT_SPEC.md), informed by one household’s vendor research and booking experience.
- Published three static design concepts for quote review, venue comparison and task assignment.
- Defined the pilot evaluation criteria. User testing and extraction benchmarks are planned.
