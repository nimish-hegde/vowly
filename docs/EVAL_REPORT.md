# Vowly — Quote Extraction Eval Report (`v0.3`)

Before building any screens for Vowly, I wanted to test one thing: can a cheap, fast AI model pull real pricing out of messy wedding vendor messages without making up numbers or messing up the math?

Everything in `v0.3` runs on the Gemini free tier with zero paid infrastructure, using fake lookalike quotes modeled on real wedding vendor pricing patterns (no personal names or real vendor emails are stored in this repo).

## 1. Offline baseline

First, I verified the deterministic math and grading harness offline before calling any live model:

- Calculator unit tests (`src/calculator.test.ts`): **5/5 passed** (minimum guest floors, 1-bartender-per-150-guests ratios, room capacity warnings, break-even fee notes, hourly photography).
- Mock eval harness (`npm run eval`): **10/10 passed, 0 release blockers**.

Mock runs only verify the grading script and math—they don't measure real AI accuracy.

## 2. Picking a Gemini model on the free tier

Testing live calls on Windows with a free Gemini API key surfaced a real availability constraint right away:

| Model | What happened |
|---|---|
| `gemini-2.5-flash` | HTTP 404 — no longer available to new users |
| `gemini-3.8-flash-lite` | HTTP 404 — model not found |
| `gemini-3.8-flash` | Repeated HTTP 503 overload errors |
| `gemini-3.5-flash-lite` | Availability errors |
| `gemini-3.1-flash-lite` | Worked, with occasional availability hiccups |
| `gemini-flash-lite-latest` | Most reliable on the free tier; completed both splits |

Because `latest` aliases can change underneath us, the extractor keeps `GEMINI_MODEL` configurable and logs the exact `modelVersion` Gemini returns on every run.

## 3. First live results (before the schema and prompt fixes)

### Dev split (4 quotes)

| Run | Model | Passed | Release blockers | Avg latency | Notes |
|---|---|---:|---:|---:|---|
| First try | `gemini-3.1-flash-lite` | 3/4 (75%) | 0 | 1,484 ms | Failed because a TBD AV fee was marked as an optional add-on instead of an unknown required fee |
| After prompt + label cleanup | `gemini-flash-lite-latest` | 4/4 (100%) | 0 | 1,330 ms | Fixed the TBD AV fee rule and normalized `Audio-visual` to `AV`; model, prompt, and grader all changed, so this wasn't a pure prompt-only comparison |

### Original held-out split (6 quotes)

Running on 6 unseen quotes with `gemini-flash-lite-latest` immediately exposed real bugs that the 4 dev cases didn't catch:

- **Passed:** 2/6 (**33.3%**)
- **Release blockers:** 3
- **Avg latency:** 5,286 ms (includes retry waits after HTTP 503s)

| Case | Result | Latency | What went wrong |
|---|---:|---:|---|
| `venue-fri-bartender-ratio` | Fail | 7,149 ms | Dropped `openQuestions`; subtotal came out $10,575 instead of $11,070 |
| `venue-conflict-brochure-vs-note` | Fail | 1,232 ms | Labeled a negotiated quote that conflicted with a printed brochure as `initial` instead of `revision` |
| `venue-tbd-fees-extra-charge` | Pass | 1,544 ms | — |
| `venue-multi-event-cash-only` | Fail | 1,053 ms | Dropped `openQuestions` |
| `photo-flat-with-mini-shoot` | Pass | 917 ms | — |
| `venue-unknown-currency-relative-deadline` | Fail | 19,822 ms | Dropped `openQuestions`; guessed `CAD` when the message only said `$` |

## 4. What actually broke and what we changed

Looking at those four failures, none of them were "the AI is dumb" problems—every single one pointed to a concrete gap in how we asked for and checked the output:

1. **$495 undercount on bartender staffing (P0):**
   At 168 guests with *"bartenders at $495 each (up to 150 guests per bartender)"*, you need 2 bartenders ($990), not 1 ($495). The total came out $495 low because the model returned a flat $495 fee instead of a ratio rule.
   - **Fix:** Spelled out `per_guest_ratio` + `ratioGuests` clearly in `src/extractor.ts` and made `src/validator.ts` reject any `per_guest_ratio` item missing `ratioGuests`. Code still owns all the math.

2. **Guessed currency (P0):**
   When a quote only had `$` with no `CAD` or `USD`, the model assumed `CAD`.
   - **Fix:** Added a strict rule in the prompt: bare `$` without an explicit currency code must stay `UNKNOWN`. In `src/eval.ts`, guessing a currency when the ground truth is `UNKNOWN` now counts as a release blocker.

3. **Dropped required arrays and `undefined` in JSON (P0):**
   The first prompt had TypeScript types like `string | undefined`, which caused Gemini to emit literal `undefined` (breaking `JSON.parse`). Even after cleaning that up, Gemini still dropped `openQuestions` on 3 of 6 held-out quotes, crashing the grader.
   - **Fix:** Switched Gemini calls to use a native `responseSchema` with `required` arrays (`events`, `lineItems`, `openQuestions`), added runtime validation in `src/validator.ts`, and made `src/eval.ts` log malformed or failed responses without crashing the rest of the run.

4. **Brochure vs. negotiated note classified as `initial` (P1):**
   When a message compared a handwritten negotiated offer to a printed brochure, Gemini called it an `initial` quote.
   - **Fix:** Clarified in the prompt that any negotiated change, updated offer, or conflict with an earlier brochure counts as a `revision`.

5. **API stability on the free tier:**
   Frequent 503s killed whole runs, and `process.exit(1)` triggered a Node handle warning on Windows.
   - **Fix:** Consolidated `fetchWithRetry` (handles 429, 502, 503, and 504 with 5s/10s/20s backoff, respects `Retry-After`, adds a 30s timeout), added a small default 1.5s gap between free-tier Gemini calls, and switched to `process.exitCode = 1`.

## 5. Dataset update and next measurement

Because we already looked at the failures on the original 6 held-out cases, those 6 are no longer unseen. I moved them to `eval-data/regression/cases.json` so we never regress on them, and added **10 fresh, untouched quotes** in `eval-data/held-out/cases.json` (20 cases total—small enough to run cleanly on the Gemini free tier).

### Status against `v0.3` targets

**`v0.3` has NOT passed its live acceptance bar yet.** These numbers will be filled in after running the updated code against live Gemini on the regression and new held-out splits:

| Metric | Target | Current status |
|---|---|---|
| Unit tests (calculator, validator, grader) | 100% pass | Passing offline (`npm test`) |
| Offline mock eval (all 20 cases) | 100% pass | Passing offline (`npm run eval`) |
| Live case-level accuracy (new held-out) | ≥90% | Pending live rerun |
| Critical financial errors | 0 | Pending live rerun |
| Unsupported currency guesses | 0 | Pending live rerun |
| Missing required fields | 0 | Pending live rerun |
| Eval crashes on single failed call | 0 | Fixed and unit-tested |

### How to run the live re-evaluation

```powershell
$env:GEMINI_API_KEY="your-free-key"
npm run eval:dev
npm run eval:regression
npm run eval:held-out
```
