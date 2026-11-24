# Vowly changelog

## Unreleased

Follow the [pilot backlog](https://github.com/nimish-hegde/vowly/issues) for planned work. Add completed user-facing improvements here with a link to the PR and any measured result.

## November 23, 2026 — Live Gemini eval baseline and extraction reliability (`v0.3`, `#2`)

- Ran the first live quote-extraction tests on Windows using the Gemini free tier (`gemini-flash-lite-latest`): **4/4** on dev after prompt cleanup, **2/6 (33.3%)** on the original held-out split with 3 release blockers.
- Documented the real failures and fixes in [the eval report](docs/EVAL_REPORT.md): a $495 bartender ratio undercount, a guessed `CAD` currency on bare `$`, dropped `openQuestions` arrays, a misclassified negotiated quote, and HTTP 503 crashes.
- Updated `src/extractor.ts` to use Gemini's native `responseSchema`, a cleaned-up prompt, bounded retries (`429`/`502`/`503`/`504` with `Retry-After` and 30s timeout), and `modelVersion` + token tracking.
- Added runtime schema and source-passage validation (`src/validator.ts`), equivalent vendor term normalization, and unit tests covering calculator, validator, and grader edge cases (`13/13` passing).
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
