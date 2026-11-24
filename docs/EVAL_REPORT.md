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

## 5. Second live run (after PR #10)

Re-running `npm run eval:regression` on the Gemini free tier (`gemini-flash-lite-latest`) after PR #10 showed a big jump:

| Metric | Baseline (before PR #10) | After PR #10 |
|---|---:|---:|
| Regression pass rate | 2/6 (33.3%) | **5/6 (83.3%)** |
| Critical financial errors | 1 ($495 undercount) | **0** |
| Unsupported currency guesses | 1 (`CAD` on bare `$`) | **0** |
| Dropped required arrays | 3 | **0** |
| Release blockers | 3 | **0** |

The only remaining failure was `venue-unknown-currency-relative-deadline`: the model correctly kept currency as `UNKNOWN` and got the math right, but did not generate an `openQuestions` entry for the unresolved relative payment deadline / missing currency.

## 6. Follow-up fixes, expanded dataset, and Quote Review UI

To close out the remaining regression failure and prepare for `v0.4`:

1. **Actionable open questions (`src/extractor.ts`):** Updated the prompt so Gemini explicitly generates an open question when currency is `UNKNOWN` or a payment deadline is relative to an unstated event date, without adding noisy questions for complete quotes.
2. **Live progress and retry indicators (`src/eval.ts`, `src/extractor.ts`):** Added live `[i/N]` progress printing and retry notices so you can see which quote is running and when a backoff wait happens.
3. **Expanded dataset (45 cases total):** Kept the 6 regression cases untouched, added 10 new `dev` cases (14 total), and added 15 new `held-out` cases (25 total) across venues, photography, decor, catering, and entertainment.
4. **Quote Review UI & instrumentation (`src/review.ts`, `src/server.ts`, `ui/index.html`, `src/telemetry.ts`):** Added a local Quote Review screen (`npm run ui`) where couples can review extracted line items beside source text, fix mistakes, resolve open questions, and approve a quote before it changes their wedding budget—backed by telemetry tracking extraction success rate, latency, tokens, estimated cost, field corrections, unresolved questions, and approval rate.

## 7. Third live run — 45-case baseline (`gemini-3.5-flash-lite`)

Running the full 45-case dataset live on `gemini-3.5-flash-lite` gave our first real measurement across all splits and vendor categories (preserved here as the first-attempt baseline before the fixes below):

| Metric | First-attempt live baseline (`gemini-3.5-flash-lite`) |
|---|---:|
| End-to-end success (all cases) | **36/45 (80.0%)** |
| Extraction accuracy (completed responses) | **36/44 (81.8%)** |
| API availability | **44/45 (97.8%)** |
| Schema validity (of completed responses) | **44/44 (100.0%)** |
| Regression split | **4/6 (66.7%)** |
| Dev split | **12/14 (85.7%)** |
| Original held-out split | **20/25 (80.0%)** |
| Critical financial errors | **1** (`dev-photo-conflict-contract-vs-dm`: `$6,800` vs `$3,200`) |
| Unsupported currency guesses | **0** |
| Total retries | **14** |

### Root-cause analysis of the 9 failures

1. **P0 — Conflicting prices double-counted (`dev-photo-conflict-contract-vs-dm`, `$6,800` instead of `$3,200`):**
   - **Root cause:** The data model (`LineItem`) only had a single `amount` and `sourceExcerpt`, with no field to hold competing candidate prices for the same service. Trying to preserve both the `$3,200` Instagram DM rate and the `$3,600` PDF contract rate, the model emitted two separate billable line items, and the calculator summed both (`$3,200 + $3,600 = $6,800`). Approval also didn't block unresolved price conflicts.
   - **Fix across all layers:**
     - `src/types.ts` & `src/validator.ts`: Added `conflictingOptions: PriceOption[]` on `LineItem` and verbatim `sourceExcerpt` validation for every option.
     - `src/extractor.ts`: Instructed the model to represent conflicting prices for the same service as **one** line item (never two), preserve all candidate prices and verbatim excerpts in `conflictingOptions`, and emit a `conflict` open question stating both amounts and the discrepancy.
     - `src/calculator.ts`: Computes `priceConflicts` (including exact numeric `discrepancy`, e.g. `$400`) without ever adding candidate prices together.
     - `src/review.ts`, `src/server.ts`, `ui/index.html`: Blocks budget approval until the couple picks which candidate price applies (`resolvePriceConflict` / `POST /api/review/resolve-conflict`), then recalculates the subtotal and budget cleanly for whichever option is chosen.

2. **P1 — Venue vs. catering classification (6 failures: `venue-conflict-brochure-vs-note`, `venue-tbd-fees-extra-charge`, `heldout-venue-email-contract-conflict`, `heldout-venue-optional-station-tbd-corkage`, `heldout-venue-open-bar-ratio-plus-min`, `heldout-venue-revision-conflict-gratuity`):**
   - **Root cause:** Adding `catering` to the category enum without defining `venue` vs. `catering` caused the model to label banquet halls and convention centres as `catering` whenever food words ("dinner", "menu", "appetizers", "catering") appeared.
   - **Fix:** Added a clear commercial-role rule in `src/extractor.ts` (`venue` provides the physical event space even when food/drinks/staffing are bundled; `catering` provides food/beverage independently of the space, including off-site caterers operating at a separate venue). Added `'unknown'` to `VendorCategory` so genuinely ambiguous vendor roles stay `unknown` with an `ambiguous_rule` clarification question instead of guessing. Added paired dev cases (`dev-venue-bundled-inhouse-catering`, `dev-catering-independent-at-venue`, `dev-category-ambiguous-vendor`).

3. **P1 — Missing unpriced mandatory/conditional charges (2 failures: `venue-initial-min-guests`, `venue-tbd-fees-extra-charge`):**
   - **Root cause:** Stated additional charges without a dollar figure — especially conditional surcharges phrased as *"costs extra ... pricing TBD once you pick a setup"* or *"has an extra charge per person"* — were either omitted or treated as optional add-ons, dropping them from `unknownItems`.
   - **Fix:** Added `chargeType: 'mandatory' | 'conditional' | 'optional'` to `LineItem` (validated in `src/validator.ts`, where `optionalAddon: true` is rejected on `mandatory` or `conditional` items). Updated `src/extractor.ts` with general cross-category rules to extract every distinct stated additional charge with `amount: null`, keep mandatory and conditional unpriced charges non-optional, and raise `missing_price` open questions. `src/calculator.ts` keeps both mandatory and conditional unpriced charges in `unknownItems`, and `src/review.ts` blocks budget approval until resolved.

4. **P2 — Provider reliability (1 failure on held-out photography after 3 HTTP 503 retries):**
   - **Root cause:** Transient Gemini free-tier 503 overload exhausted all 3 retries — a provider outage, not a schema or extraction error.
   - **Fix:** Added `latencyWithoutRetriesMs` in `src/extractor.ts` and updated `src/eval.ts` to report six distinct metrics: **API availability**, **schema validity**, **extraction accuracy (completed responses)**, **end-to-end success (all cases)**, **average latency including retries**, and **average latency excluding retries**, plus a `--show-raw` flag for inspecting failed raw JSON outputs.

## 8. Fourth live run — 60-case verification of commit `65f1392` (`gemini-3.5-flash-lite`)

Re-running all four splits live after the P0–P2 fixes jumped overall accuracy from **80.0%** to **91.7%** and cleared both the regression split (**6/6**) and the original held-out split (**25/25**) with zero critical financial errors and zero currency guesses:

| Metric | First baseline (45 cases) | After `65f1392` (60 cases) |
|---|---:|---:|
| End-to-end success | 36/45 (80.0%) | **55/60 (91.7%)** |
| API availability | 44/45 (97.8%) | **60/60 (100.0%)** |
| Schema validity (completed) | 44/44 (100.0%) | **60/60 (100.0%)** |
| Regression split | 4/6 (66.7%) | **6/6 (100.0%)** |
| Dev split | 12/14 (85.7%) | **15/17 (88.2%)** |
| Original held-out split | 20/25 (80.0%) | **25/25 (100.0%)** |
| Fresh `held-out-v2` split | — | **9/12 (75.0%)** |
| Critical financial errors | 1 (`$6,800` double-count) | **0** |
| Unsupported currency guesses | 0 | **0** |
| Average latency | — | **~1.90s** |
| Est. paid cost (free tier = `$0`) | — | **`$0.01683` across 60 extractions** |

### Root-cause analysis of the 5 remaining failures & CLI bug

1. **P0 — Conflict representation shape (3 failures: Photography `$3,200` vs `$3,600`, DJ `$1,900` vs `$2,250`, Decor `$4,800` vs `$5,300`):**
   - **Root cause:** Gemini correctly detected all three price conflicts, kept the primary price in `LineItem.amount` (so it stopped double-counting!), and placed **only the alternative price** in `conflictingOptions` (length 1). Both `src/calculator.ts` and `src/review.ts` checked `conflictingOptions.length >= 2`, so all three conflicts went undetected and would have permitted budget approval.
   - **Fix:** Added [`normalizeConflictingOptions`](../src/calculator.ts) to deterministically support both shapes (primary in `amount` + alternative(s) in `conflictingOptions`, OR all candidates listed in `conflictingOptions`), deduplicate equivalent candidates, preserve verbatim source evidence, compute the discrepancy, and block approval until resolved via [`resolvePriceConflict`](../src/review.ts). Updated `src/eval.ts` so any undetected unresolved price conflict that would permit budget approval is now a **release blocker**.

2. **P1 — Ambiguous vendor classification (2 failures: `dev-category-ambiguous-vendor`, `heldout2-category-ambiguous-reception-package`):**
   - **Root cause:** Both messages had generic vendor names (`Sunrise Events`, `Crescent Hospitality Group`) with per-person dinner packages and no venue-space cues, yet Gemini still labeled both as `venue`.
   - **Fix:** Tightened Rule 3 in `src/extractor.ts` to require explicit physical-space evidence for `venue` (hall, ballroom, convention centre, estate, hotel, room rental, capacity, parking). Dinner packages, per-person pricing, setup fees, or minimum guest counts alone must return `category: "unknown"` with an `ambiguous_rule` clarification question.

3. **P2 — Eval CLI `--provider` flag silently ignored:**
   - **Root cause:** `src/eval.ts` only read `EXTRACTOR_PROVIDER` from the environment and ignored unknown CLI flags, so `--provider gemini` was silently ignored and could fall back to `mock` if `GEMINI_API_KEY` was unset.
   - **Fix:** Added strict [`parseEvalArgs`](../src/eval.ts) and [`resolveEvalProvider`](../src/eval.ts) to support `--provider gemini|ollama|mock`, reject unknown flags, and refuse to fall back to `mock` when a live provider is explicitly requested.

### Offline validation after these fixes

- **Unit tests (`npm test`):** **37/37 passed** (including all three observed single-alternative live conflict shapes, deduplication, review approval blocking + resolution to either price, undetected conflict release blocker, and strict `--provider` CLI tests).
- **Offline mock eval (`npm run eval`):** **60/60 passed (100.0%)**, 0 critical financial errors, 0 currency guesses, 0 release blockers (`dev` 17/17, `regression` 6/6, `held-out` 25/25, `held-out-v2` 12/12).

### Status against `v0.3` release criteria

| Metric | Release bar | Live (`65f1392`) | Post-fix status |
|---|---|---|---|
| Unit tests (`npm test`) | 100% pass | 33/33 | **37/37 passing offline** |
| Regression pass rate (live) | 100% (6/6) | **6/6 (100.0%)** | **Met** (re-verify after prompt tweak) |
| Original held-out accuracy (live) | Preserved baseline | **25/25 (100.0%)** | **Met** (re-verify after prompt tweak) |
| Critical financial errors (live) | 0 | **0** | **Met** |
| Unsupported currency guesses (live) | 0 | **0** | **Met** |
| Schema validity (live) | ≥99% | **60/60 (100.0%)** | **Met** |
| Average extraction latency (live) | <5s | **~1.90s** | **Met** |
| Conflict detection & ambiguous category (live) | 0 undetected conflicts | 3 undetected conflicts, 2 ambiguous categories | **Re-verify live on `dev` + `held-out-v2`** |

### PowerShell commands for final live verification

```powershell
git pull
$env:GEMINI_API_KEY="your-free-key"
$env:GEMINI_MODEL="gemini-3.5-flash-lite"

npm test
node src/eval.ts --provider gemini --split regression --show-raw
node src/eval.ts --provider gemini --split dev --show-raw
node src/eval.ts --provider gemini --split held-out --show-raw
node src/eval.ts --provider gemini --split held-out-v2 --show-raw
```
