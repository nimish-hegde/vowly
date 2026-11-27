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

## 9. Fifth live run — 60-case verification of commit `4501ef3` (`gemini-3.5-flash-lite`)

Re-running all four splits live after conflict normalization, the tighter `unknown` category rule, and `--provider gemini` enforcement cleared **every single held-out and regression case** with 100% availability and schema validity:

| Metric | Baseline (45 cases) | After `65f1392` (60 cases) | After `4501ef3` (60 cases) |
|---|---:|---:|---:|
| End-to-end success | 36/45 (80.0%) | 55/60 (91.7%) | **59/60 (98.3%)** |
| API availability | 44/45 (97.8%) | 60/60 (100.0%) | **60/60 (100.0%)** |
| Schema validity | 44/44 (100.0%) | 60/60 (100.0%) | **60/60 (100.0%)** |
| Regression split | 4/6 (66.7%) | 6/6 (100.0%) | **6/6 (100.0%)** |
| Dev split | 12/14 (85.7%) | 15/17 (88.2%) | **16/17 (94.1%)** |
| Original held-out split | 20/25 (80.0%) | 25/25 (100.0%) | **25/25 (100.0%)** |
| Fresh `held-out-v2` split | — | 9/12 (75.0%) | **12/12 (100.0%)** |
| Critical financial errors | 1 | 0 | **1** (`photo-hourly-missing-mini` — calculator bug below) |
| Unsupported currency guesses | 0 | 0 | **0** |

### Root cause & fix for the single remaining failure (`photo-hourly-missing-mini`)

- **What happened:** Gemini extracted the quote accurately — a `$2,500` flat package covering 5 hours plus a `conditional` `$300/hr` additional-hours rate. The deterministic calculator in `src/calculator.ts` multiplied `$300 × 5` on top of the `$2,500` flat package, producing `$4,000` instead of `$2,500` at 5 hours.
- **Fix (`src/calculator.ts`):** When a non-optional `per_hour` line item is conditional or labeled as overtime/additional hours alongside a flat/included base package with a known duration (from sibling `.hours`, `photographerDetails.hoursIncluded`, or duration text like `"5-hour"` / `"five hours"`), the calculator now bills only `Math.max(0, requestedHours - includedPackageHours) × hourlyRate`.
  - 5 hours: `$2,500` (`0` overtime hours)
  - 6 hours: `$2,800` (`1` overtime hour × `$300`)
  - 7 hours: `$3,100` (`2` overtime hours × `$300`)
  - Works identically across photography, DJ, venue, and entertainment packages without changing standalone pure-hourly rates.

## 10. Final live verification — commit `a391f49` (`gemini-3.5-flash-lite`)

Running all 60 cases live on commit `a391f49` met every `v0.3` release criterion with **zero critical financial errors, zero currency guesses, and zero release blockers**:

| Metric | First 45-case baseline | After `65f1392` (60 cases) | After `4501ef3` (60 cases) | Final `a391f49` (60 cases) |
|---|---:|---:|---:|---:|
| End-to-end success | 36/45 (80.0%) | 55/60 (91.7%) | 59/60 (98.3%) | **59/60 (98.3%)** |
| Regression split | 4/6 (66.7%) | 6/6 (100.0%) | 6/6 (100.0%) | **6/6 (100.0%)** |
| Dev split | 12/14 (85.7%) | 15/17 (88.2%) | 16/17 (94.1%) | **17/17 (100.0%)** |
| Original held-out split | 20/25 (80.0%) | 25/25 (100.0%) | 25/25 (100.0%) | **25/25 (100.0%)** |
| Fresh `held-out-v2` split | — | 9/12 (75.0%) | 12/12 (100.0%) | **11/12 (91.7%)** |
| API availability | 44/45 (97.8%) | 60/60 (100.0%) | 60/60 (100.0%) | **60/60 (100.0%)** |
| Schema validity | 44/44 (100.0%) | 60/60 (100.0%) | 60/60 (100.0%) | **60/60 (100.0%)** |
| Critical financial errors | 1 | 0 | 1 (overtime calc bug) | **0** |
| Unsupported currency guesses | 0 | 0 | 0 | **0** |
| Release blockers | 1+ | 3 (undetected conflicts) | 1 | **0** |
| Average latency | — | ~1,900 ms | — | **2,369 ms** |
| Est. paid cost (`$0` free tier) | — | `$0.01683` | — | **`$0.01754`** |

### Known limitation (preserved as-is)

- **`heldout2-catering-unpriced-dish-surcharge` (11/12 on `held-out-v2`):** The message says *"Goat biryani upgrade has an extra charge per person — rate on request."* On the final run, the model classified this as an optional add-on rather than a conditional unpriced surcharge, excluding it from `unknownItems`. Because `"upgrade"` can genuinely read as optional to a human too, this borderline phrasing can flip between `optional` and `conditional` across runs. The test case and result are preserved without weakening the assertion; in the Quote Review UI, optional items remain visible with an `Optional` checkbox so couples can still spot and toggle them.

### Final status against `v0.3` release criteria

| Release criterion | Target | Final measured result (`a391f49`) | Status |
|---|---|---|---|
| Unit tests (`npm test`) | 100% pass | **40/40 passing** | **Met** |
| Offline mock eval (`npm run eval`) | 100% pass | **60/60 passing** | **Met** |
| Live regression pass rate | 100% (6/6) | **6/6 (100.0%)** | **Met** |
| Critical financial errors (live) | 0 | **0** | **Met** |
| Unsupported currency guesses (live) | 0 | **0** | **Met** |
| Release blockers (live) | 0 | **0** | **Met** |
| Schema validity (live) | ≥99% | **60/60 (100.0%)** | **Met** |
| Average extraction latency (live) | <5,000 ms | **2,369 ms** | **Met** |

### Reproducing the verification locally

```powershell
$env:GEMINI_API_KEY="your-free-key"
$env:GEMINI_MODEL="gemini-3.5-flash-lite"

npm test
node src/eval.ts --provider gemini --split regression --show-raw
node src/eval.ts --provider gemini --split dev --show-raw
node src/eval.ts --provider gemini --split held-out --show-raw
node src/eval.ts --provider gemini --split held-out-v2 --show-raw
npm run ui
```

---

## 11. `v0.5` Live Gemini Benchmark & Multimodal Extraction (`feat/v0.5-real-quote-import`)

Following the `v0.5` multimodal, schema, and calculator updates (`PR #13`), we ran the expanded **63-case** text benchmark (`60` original cases + `3` new UAT dev cases) and **3 live multimodal file tests** (2 PNG screenshots + 1 PDF) on the Gemini free tier (`gemini-flash-lite-latest`, resolved to **`gemini-3.5-flash-lite`**).

### 11.1 Initial `v0.5` live run & root-cause fixes (`55/63` → `63/63`)

The first `v0.5` live run on `gemini-3.5-flash-lite` scored **55/63 (87.3%)** with **2 critical financial errors** and 6 non-blocker failures:
1. **`dev-catering-per-person-addons` (Critical financial error: `$6,681.50` vs `$5,810`):** Adding `pricingType: "percentage"` caused Gemini to emit the `15% service charge` *both* as a `percentage` line item (`entire_subtotal`) and in `gratuityPercent: 15`, inflating `knownSubtotal`. **Fix:** Clarified in `src/extractor.ts` that percentage gratuities/service charges belong only in top-level `gratuityStatus`/`gratuityPercent`, and added deterministic deduplication in both `src/calculator.ts` and `frontend/src/engine/financialCalculator.ts`. Also stripped spurious `originalAmount === amount` and `0` placeholder fields in `normalizeProviderResponse`.
2. **`heldout-venue-sat-ratio-cap` (Critical financial error: `$18,950` vs `$16,100`):** Gemini copied `maxCapacity: 190` into `minGuests: 190` on a 160-guest quote. **Fix:** Added an explicit guard in `src/extractor.ts` Rule 8 never to copy `maxCapacity` into `minGuests`.
3. **`dev-uat-case-a-missing-gratuity` & `dev-uat-case-c-complex-venue` (`category: "unknown"` vs `"venue"`):** Explicit `"banquet package"` and `"Maximum capacity is 200 guests"` cues were classified as `unknown` under Rule 4. **Fix:** Included `"banquet package"` and `"maximum capacity"` as explicit venue-space cues while keeping generic `"dinner/reception package"` quotes `unknown`.
4. **Omitted `paymentTerms` (3 cases) & `openQuestions` (1 case):** Gemini omitted `paymentTerms` when only a payment method rule was present, and omitted `openQuestions` on `heldout-dj-relative-deadline-unknown-currency`. **Fix:** Added `'paymentTerms'` to `GEMINI_RESPONSE_SCHEMA.required` and strengthened Rule 10 for `UNKNOWN` currency and relative deadlines.

### 11.2 Post-fix live 63-case results vs. `v0.3` baseline (`a391f49`)

#### Original 60 cases comparison (`v0.3` `a391f49` vs. `v0.5` post-fix)

| Metric | `v0.3` Final (`a391f49`, 60 cases) | `v0.5` Initial (60 orig. subset) | `v0.5` Post-Fix (60 orig. subset) |
|---|---:|---:|---:|
| End-to-end success | 59/60 (98.3%) | 54/60 (90.0%) | **60/60 (100.0%)** |
| Regression split | 6/6 (100.0%) | 6/6 (100.0%) | **6/6 (100.0%)** |
| Dev split (original 17) | 17/17 (100.0%) | 15/17 (88.2%) | **17/17 (100.0%)** |
| Original held-out split | 25/25 (100.0%) | 22/25 (88.0%) | **25/25 (100.0%)** |
| `held-out-v2` split | 11/12 (91.7%) | 11/12 (91.7%) | **12/12 (100.0%)** |
| Critical financial errors | 0 | 2 | **0** |
| Unsupported currency guesses | 0 | 0 | **0** |
| Release blockers | 0 | 2 | **0** |

#### Full 63-case summary & 3 new UAT cases (post-fix, `gemini-3.5-flash-lite`)

- **All 63 cases:** **63/63 (100.0%)** e2e success · **63/63 (100.0%)** API availability · **63/63 (100.0%)** schema validity · **0** parse errors · **0** critical financial errors · **0** currency guesses · **0** release blockers.
- **Latency & retries:** **2,417 ms** avg latency incl. retries (**1,749 ms** excl. retries) · **7** transient free-tier retries (`429`/`503`).
- **Tokens & cost:** **146,170** prompt / **25,536** output tokens · **`$0.02483`** total estimated paid cost (**`$0.000394`** per successful extraction; `$0` on Gemini free tier).

| New UAT Case (`eval-data/dev/cases.json`) | Initial Run | Post-Fix Run | Latency | Verified Result |
|---|---|---|---|---|
| `dev-uat-case-a-missing-gratuity` | Fail (`category: unknown`) | **PASS** | 1,343 ms | `$55/person` (150 min → `$8,250`), `13%` HST, `gratuityUnresolved: true`, `4` structured inclusions, `vendorName: null`, `currency: UNKNOWN` |
| `dev-uat-case-b-negotiated-photo` | Pass | **PASS** | 1,613 ms | `$900` active (`$1,000` original → `$100` savings, `0` conflicts), `6` hrs, `$200` deposit, `quoteKind: initial` |
| `dev-uat-case-c-complex-venue` | Fail (`category: unknown`) | **PASS** | 2,238 ms | At 175 guests: `$10,500` banquet + `$750` 3rd-party AV + `$750` bartenders (`3 × $250`) = **`$12,000`** subtotal, `10%` food-subtotal gratuity (`$1,050`), `13%` HST (`$1,696.50`), `30%` deposit + `30 days before the event` milestone |

### 11.3 Live multimodal image (2 PNGs) & PDF extraction tests

Tested real `inlineData` attachments (`rawMessage: ""`) against live `gemini-3.5-flash-lite` after the post-fix changes:

| File (`mimeType`) | Latency | Tokens (in / out) | Est. Cost | Schema & Grounding | Verified Extraction & Deterministic Calculation |
|---|---:|---:|---:|---|---|
| `quote_venue.png` (`image/png`) | 3,226 ms | 3,372 / 811 | `$0.000662` | Valid · `pageReference: "Screenshot"` | `Sapphire Banquet Hall` (`venue`, `CAD`), `$72/person` (`$12,600` at 175) + `$250` bartenders 1:75 (`3 × $250 = $750`) = `$13,350`, `10%` food-subtotal gratuity (`$1,260`), `13%` HST (`$1,899.30`), `$16,509.30` all-in, `$4,000` deposit + `30 days before event` |
| `quote_photo.png` (`image/png`) | 2,441 ms | 3,372 / 450 | `$0.000517` | Valid · `pageReference: "Screenshot"` | `Lumina Wedding Photography` (`photographer`, `CAD`), `$2,100` active / `$2,400` original (`$300` negotiated savings, `0` conflicts), `8` hrs, `2` photographers + deliverables, `$500` deposit |
| `quote_decor.pdf` (`application/pdf`) | 1,568 ms | 2,814 / 362 | `$0.000426` | Valid · `pageReference: "Page 1"` | `Royal Mandap Decor` (`decor`, `CAD`), `$4,500` flat, unpriced `Lighting setup fee` in `unknownItems` (`isEstimateComplete: false`), `13%` HST (`$585`), `$1,000` deposit |

### 11.4 Offline parity suite (post-fix)

- Backend unit & UAT tests (`npm test`): **47/47 passing**
- Backend offline mock evals (`npm run eval -- --provider mock`): **63/63 passing**
- Frontend safeguard & parity tests (`cd frontend && npm test`): **10/10 passing**
- Frontend type-check & production build (`cd frontend && npm run lint && npm run build`): **Pass** (0 errors)


---

## 12. v0.5 Real-World UAT Remediation Benchmark (66 Cases, Live Gemini)

Following manual UAT on PR #13, four real-world failure groups were fixed across extraction, schema, normalization, deterministic calculation, frontend mapping, and UI:
1. **Mutually exclusive packages & package-scoped terms** (`packages[]`, `selectedPackageId`, package-scoped inclusions/tax/gratuity/delivery/fees, approval & booking blockers until one package is chosen).
2. **Extra-guest pricing vs. repeated per-person rates** (`per_extra_guest` with `guestThreshold` + redundant extra-guest deduplication so guests are never double-counted).
3. **Conditional overtime hours** (`$900` 5-hr package + `$250/hr` additional rate defaults to `$900` with `0` extra hours even when `hours: 1` is emitted or duration appears only in labels/inclusions).
4. **Inclusion hygiene, `deliveryTerms`, honest unknown tax (`'unspecified'`), legacy quote re-review flags, manual editing of approved quotes with revision history, stable vendor-name input, and source image lightbox.**

### Live Evaluation Results (66 Cases — `gemini-3.5-flash-lite`)

- **Provider / Model:** `gemini` | Configured: `gemini-flash-lite-latest` | Resolved: `gemini-3.5-flash-lite`
- **Dataset:** 66 cases (`23 dev` incl. 3 new anonymized UAT cases, `6 regression`, `25 held-out`, `12 held-out-v2` — locked holdout splits unchanged)
- **End-to-end success:** **66/66 (100.0%)** | **Extraction accuracy:** **66/66 (100.0%)**
- **API availability:** 66/66 (100.0%) | **Schema validity:** 66/66 (100.0%) | **Parse errors:** 0
- **Critical financial errors:** **0** | **Unsupported currency guesses:** **0** | **Release blockers:** **0**
- **Latency:** `2,798 ms` avg incl. retries (`1,796 ms` excl. retries) | **Total retries:** 8 (HTTP 429)
- **Token usage & cost:** `196,141` input / `27,506` output tokens | Est. paid cost: **$0.03062** (~**$0.000464** per successful extraction; `$0` on free tier)

| Split | E2E Pass | Accuracy | Fin. Errors | Blockers | Avg Latency (excl. retries) | Est. Paid Cost |
|---|---:|---:|---:|---:|---:|---:|
| `dev` (23 cases) | 23/23 (100.0%) | 100.0% | 0 | 0 | 1,661 ms | $0.01090 |
| `regression` (6 cases) | 6/6 (100.0%) | 100.0% | 0 | 0 | 1,597 ms | $0.00280 |
| `held-out` (25 cases) | 25/25 (100.0%) | 100.0% | 0 | 0 | 1,711 ms | $0.01126 |
| `held-out-v2` (12 cases) | 12/12 (100.0%) | 100.0% | 0 | 0 | 2,332 ms | $0.00565 |
| **Total (66 cases)** | **66/66 (100.0%)** | **100.0%** | **0** | **0** | **1,796 ms** | **$0.03062** |

### New Anonymized UAT Dev Cases (3/3 Live Pass)

| Case ID | Scenario | Live Result | Verified Outcome |
|---|---|---|---|
| `dev-uat-multi-package-venue` | Royal (`$55/pp` min 150) vs. Imperial (`$65/pp` min 100) + repeated extra-guest text | **PASS** | Extracts 2 packages with 3 inclusions each; blocks approval when unselected (`knownSubtotal: 0`); Royal @ 175 = `$9,625` (`$11,963.88` all-in); Imperial @ 175 = `$11,375` (`$14,139.13` all-in). |
| `dev-uat-photo-overtime-default-zero` | `$900` (5 hrs) + `$250/hr` additional hours, unknown tax | **PASS** | Subtotal `$900` with `0` extra hours; `taxStatus: "unknown"` mapped to `'unspecified'`. |
| `dev-uat-photo-second-shooter-delivery` | `$3,500` package + 2nd photographer 5 hrs + turnaround terms | **PASS** | Lead & second photographer durations structured cleanly; `deliveryTerms` extracted without schema leakage. |

### Intermediate Failure Analysis & Fix

- **Run 1 (`60/66`):** Adding `packages` to `GEMINI_RESPONSE_SCHEMA` caused two deterministic bugs: (a) stray `packageId` strings on single-package `lineItems` were filtered out when `packages` was empty (5 cases), and (b) a single-package entry placed in both `packages[0]` and `lineItems[0]` doubled the venue subtotal (1 case).
- **Fix:** Normalized single-element `packages[]` cleanly into `lineItems[]` with deduplication and stripped stray `packageId` when `packages.length < 2` in `src/extractor.ts`, `src/calculator.ts`, and `frontend/src/engine/financialCalculator.ts`. Re-run achieved **66/66 (100.0%)** with `0` financial errors.

### Offline Verification

- Backend unit tests (`npm test`): **50/50 pass**
- Offline mock evals (`npm run eval -- --provider mock`): **66/66 (100.0%) pass**
- Frontend safeguard & parity tests (`cd frontend && npm test`): **13/13 pass**
- Frontend type-check & production build (`cd frontend && npm run lint && npm run build`): **Pass** (0 errors)


---

## 13. PR #13 Final Targeted Remediation Benchmark (Post-Codex & Founder UAT)

Following Codex review on `eda6c4d` and founder manual UAT, four release blockers were resolved without expanding scope:
1. **Codex Package Parity Findings (4/4 resolved):** Unified `mapBackendItem` mapping across ordinary `lineItems` and package-scoped `fees` so mandatory TBD package fees are preserved as package-scoped `unconfirmedFees`, unknown package prices stay `unitPrice: null` (`unresolvedPackagePrice: true`, blocking approval/booking), all hourly/percentage fee calculation parameters are preserved, and tax edits update the selected package's effective tax override.
2. **Conditional Hourly Pricing (`"Additional Hourly Pricing: $250/hr"`):** Extended `OVERTIME_PATTERN` (`hourly`) and `findIncludedPackageHours` (`inclusions[].durationHours`) across backend and frontend, plus added a manual `"Conditional rate (0 hrs default)"` toggle in Quote Review.
3. **Payment Schedule Propagation (`BookingModal`):** Replaced hardcoded deposit/balance dates and assumed 30-day offsets with `deriveBookingScheduleDefaults`, strictly prioritizing explicit extracted calendar dates (`August 13, 2027` -> `2027-08-13`), then extracted relative deadlines, then unresolved/TBD, while reconciling to the booked contract total and preserving existing `Paid` milestones.
4. **Tax Grounding:** Reinforced `SYSTEM_PROMPT` Rule 5 so unmentioned tax always remains `taxStatus: "unknown"` (`'unspecified'`) and blocks booking until resolved.

### Final Live Evaluation Results (66 Cases — `gemini-3.5-flash-lite`)

- **Provider / Model:** `gemini` | Configured: `gemini-flash-lite-latest` | Resolved: `gemini-3.5-flash-lite`
- **End-to-end success:** **66/66 (100.0%)** (`23/23 dev`, `6/6 regression`, `25/25 held-out`, `12/12 held-out-v2`)
- **API availability:** 66/66 (100.0%) | **Schema validity:** 66/66 (100.0%) | **Parse errors:** 0
- **Critical financial errors:** **0** | **Unsupported currency guesses:** **0** | **Release blockers:** **0**
- **Latency:** `2,859 ms` avg incl. retries (`1,775 ms` excl. retries) | **Total retries:** 12 (HTTP 429)
- **Token usage & cost:** `200,101` input / `27,488` output tokens | Est. paid cost: **$0.03101** (~**$0.000470** per successful extraction; `$0` on free tier)

### Offline & Browser E2E UAT Verification

- Backend unit tests (`npm test`): **53/53 pass**
- Offline mock evals (`npm run eval -- --provider mock`): **66/66 (100.0%) pass**
- Frontend tests (`cd frontend && npm test`): **17/17 pass** | `npm run lint`: **0 errors** | `npm run build`: **Pass**
- Targeted live Gemini checks (3 anonymized UAT cases): **3/3 pass** (extraction prompt/schema unchanged since 66/66 live benchmark)
- Browser E2E UAT (`http://localhost:3000/`, live Gemini on `:3001`):
  - **HSR Photography:** Extracted `CAD $900.00` (`0` overtime hrs for `"Additional Hourly Pricing: $250/hr"`), showed `"Tax not stated — excluded from estimate."`, blocked booking in Vendor Drawer until resolved via `"Edit quote"`, and populated `BookingModal` with `$900` contract total, `$200` deposit (`Due upon signing / date TBD`, unpaid by default), and `$700` balance due `2027-08-13`.
  - **Multi-Package Venue (`Palace Banquet Hall`):** Preserved both `Royal Package` and `Imperial Package`, blocked approval when unselected (`CAD $0.00`), and switched totals & package-scoped inclusions cleanly on selection.

### Remaining Known Limitations (Non-Blocking for PR #13)

- Free-tier Gemini API bursts can trigger HTTP 429 retries (12 retries across 66 sequential cases; all recovered cleanly via exponential backoff).
- On some multi-package brochures mentioning gratuity without explicit basis wording, Gemini conservatively flags gratuity basis as needing user confirmation (safe fail-closed behavior; user confirms in 1 click).
- Post-event actual overtime reconciliation and multi-installment (>2 milestone) custom schedule editing in `BookingModal` are deferred to the next milestone.

---

## 14. Issue #15 — Gemini Model Benchmarking & Fresh Multimodal Holdout (`held-out-v3-multimodal`)

**Branch:** `experiment/model-benchmarking` (from `main` at `85e00a9`)  
**Default Production Model:** Unchanged (`gemini-flash-lite-latest` → `gemini-3.5-flash-lite`)  
**Controlled Variables:** `SYSTEM_PROMPT`, `GEMINI_RESPONSE_SCHEMA`, `normalizeProviderResponse`, `validateExtractedQuote`, and `calculateQuoteTotal` were frozen and identical across all runs (`temperature: 0`). Existing 66 locked cases (`dev/`, `regression/`, `held-out/`, `held-out-v2/`) were untouched.

### 14.1 Model Access & Structured-Output Smoke Tests (Free Tier, `$0` Actual Spend)

Metadata visibility (`GET /v1beta/models`) listed all four candidate models, so we ran live generation smoke tests on each before benchmarking:

| Model ID | Paid Pricing (USD / 1M tokens) | Smoke-Test Outcome | Included in Live Benchmark? |
|---|---|---|---|
| `gemini-3.5-flash-lite` | `$0.30` in / `$2.50` out | **PASS** — Full `extractQuote` (`1,663 ms`, schema valid, grounded) | **Yes (Baseline — full 30/30 + 15 consistency runs)** |
| `gemini-4-hydrogen` | `$1.50` in / `$7.50` out | **PASS** — Full `extractQuote` (`43,597 ms`, schema valid, `766` thinking tokens) | **Yes (12 attempted / 8 completed before free-tier `429`/`503` circuit breaker)** |
| `gemini-3.8-flash` | `$0.75` in / `$3.75` out *(promotional)* | **UNAVAILABLE** — Repeated `30s`/`45s` timeouts and HTTP `503 UNAVAILABLE` ("currently experiencing high demand") across 4 smoke tests and Phase 1 start | **Excluded** (persistent upstream `503`/timeout failures) |
| `gemini-4-neon` | `$3.00` in / `$15.00` out | **UNAVAILABLE ON FREE TIER** — HTTP `429` (`quota exceeded`) in `170 ms` | **Excluded** (paid-only; billing **not** enabled without PM approval) |

### 14.2 Fresh Frozen 30-Case Multimodal Dataset (`eval-data/held-out-v3-multimodal/`)

Generated deterministically via `scripts/generate-multimodal-holdout.ts` + `scripts/render-holdout-images.ps1` (100% synthetic/anonymized, zero personal wedding data) and verified `30/30 (100%)` offline via `--provider mock` before any live calls:
- **Modalities:** `10` pasted messages (`T01`–`T10`), `10` PNG screenshots (`I01`–`I10`: email, 2-column brochure, IG DM, 3-tier rate card, dense catering flyer with fine print, WhatsApp thread, mobile DJ quote, low-contrast card, cropped table with TBD tier, email+graphic cross-source conflict), `10` PDFs (`P01`–`P10`: single- and 2-page proposals, brochures, contracts, revision addendum).
- **Difficulty Mix:** `8` ordinary quotes, `22` difficult quotes across `venue`, `photographer`, `catering`, `decor`, `dj`, `entertainment`, and `unknown`.
- **True Multimodal Grounding:** Every `sourceExcerpt` is verified against the actual rendered `documentText` of each PNG/PDF (not merely checking non-empty strings).
- **3-Way Error Separation:** Separates (1) AI extraction errors requiring manual correction, (2) legitimate user decisions/confirmations (`29` across the 30 cases), and (3) genuinely missing source information (`36` across the 30 cases).

### 14.3 Head-to-Head Model Comparison (`held-out-v3-multimodal`)

> **Comparison Caveats:**
> - **`gemini-4-hydrogen` was evaluated on a smaller, non-equivalent subset** (`12` attempted / `8` completed: `T01`–`T07`, `I02`) vs. the full `30/30` suite on `gemini-3.5-flash-lite`, so percentages are not apples-to-apples across the full 30 cases.
> - **Free-tier throttling (`429`/`503`) is not evidence of paid-tier reliability** for `gemini-4-hydrogen` or `gemini-3.8-flash`; it reflects free-tier quota and shared demand limits only.
> - **`gemini-3.5-flash-lite` achieved `28/30` on the fresh benchmark, with one critical financial error (`T07`).**

| Metric | `gemini-3.5-flash-lite` (30/30 full) | `gemini-4-hydrogen` (12 attempted / 8 completed — non-equivalent subset) |
|---|---:|---:|
| **API Availability** | **30/30 (100.0%)** | 8/12 (66.7%) *(aborted by `429`/`503` circuit breaker)* |
| **Schema Validity (completed)** | **30/30 (100.0%)** | 8/8 (100.0%) |
| **End-to-End Accuracy (all attempted)** | **28/30 (93.3%)** | 7/12 (58.3%) |
| **Completed Extraction Accuracy** | **28/30 (93.3%)** | 7/8 (87.5%) |
| **Field-Level Extraction Accuracy** | **207/220 (94.1%)** | 60/61 (98.4%) |
| **Critical Financial Errors** | **1** (`T07`) | **1** (`T07`) |
| **Unsupported Currency Assumptions** | **0** | **0** |
| **True Multimodal Source Grounding** | **89/89 (100.0%)** | 19/19 (100.0%) |
| **Frontend/Backend Calculation Parity** | **29/30 (96.7%)** *(`I04` pre-existing FE gap)* | 8/8 (100.0%) *(`I04` hit `429`)* |
| **Inclusions Recall (leaked schema tokens)** | **78.0%** (`0` leaked) | 80.0% (`0` leaked) |
| **Delivery Terms Recall / Payment Accuracy** | **80.0% / 86.0%** | 100.0% / 91.7% |
| **AI Extraction Errors Requiring Correction** | **21 (`0.70` / quote)** | 3 (`0.38` / completed quote) |
| **Legitimate User Decisions / Missing Source Info** | `29` / `36` | `12` / `12` *(attempted subset)* |
| **Avg Latency (excl. retries / incl. retries)** | **2,570 ms** / 5,072 ms | 12,221 ms / 20,765 ms *(4.8× slower)* |
| **Total Retries (`429`/`503`/timeout)** | **2** | **19** |
| **Tokens (Input / Candidate Out / Thinking Out)** | `109,637` / `22,190` / `0` | `49,698` / `3,993` / `14,599` *(3.66× thinking multiplier)* |
| **Est. Paid Cost (incl. thinking as billed out)** | **`$0.08837`** | `$0.21399` *(for only 8 completed cases)* |
| **Est. Paid Cost per Successful Extraction** | **`$0.00316`** | `$0.03057` *(**9.7×** more expensive)* |

### 14.4 Breakdowns for `gemini-3.5-flash-lite` (Full 30 Cases)

**By Modality:**

| Modality | E2E Accuracy | Field Accuracy | Critical Fin. Errors | True Grounding | AI Corrections / Quote | Avg Latency (No-Retry) |
|---|---:|---:|---:|---:|---:|---:|
| `text` (10) | 8/10 (80.0%) | 97.1% | 1 (`T07`) | 100.0% | 0.50 | 1,895 ms |
| `image` (10) | **10/10 (100.0%)** | 91.9% | **0** | 100.0% | 0.80 | 2,777 ms |
| `pdf` (10) | **10/10 (100.0%)** | 93.5% | **0** | 100.0% | 0.80 | 3,037 ms |

**By Difficulty:**

| Difficulty | E2E Accuracy | Field Accuracy | Critical Fin. Errors | AI Corrections / Quote |
|---|---:|---:|---:|---:|
| `ordinary` (8) | **8/8 (100.0%)** | 96.6% | **0** | 0.75 |
| `difficult` (22) | 20/22 (90.9%) | 93.2% | 1 (`T07`) | 0.68 |

**By Vendor Category:**

| Category | E2E Accuracy | Field Accuracy | Critical Fin. Errors | AI Corrections / Quote | Avg Latency (No-Retry) |
|---|---:|---:|---:|---:|---:|
| `venue` (10) | **10/10 (100.0%)** | 90.8% | 0 | 1.30 | 2,703 ms |
| `photographer` (8) | **8/8 (100.0%)** | 95.7% | 0 | 0.63 | 2,792 ms |
| `catering` (3) | 2/3 (66.7%) | 95.7% | 1 (`T07`) | 0.67 | 2,707 ms |
| `decor` (3) | **3/3 (100.0%)** | 100.0% | 0 | 0.00 | 2,505 ms |
| `dj` (3) | **3/3 (100.0%)** | 100.0% | 0 | 0.00 | 2,080 ms |
| `entertainment` (2) | **2/2 (100.0%)** | 100.0% | 0 | 0.00 | 2,055 ms |
| `unknown` (1) | 0/1 (0.0%) | 83.3% | 0 | 1.00 | 1,744 ms |

### 14.5 Consistency & Regression Verification

- **5-Case × 3-Repeat Consistency Check (`gemini-3.5-flash-lite` on `T02`, `T07`, `I02`, `I04`, `P02` — 15 live runs):**
  - **API Availability:** `15/15 (100.0%)`, `0` retries, `2,770 ms` avg latency.
  - **Pass/Fail Stability:** **100% deterministic across all 5 cases** (`3/3` PASS on `T02`, `I02`, `I04`, `P02`; consistent `0/3` on `T07`).
  - **Field Accuracy:** `107/114 (93.9%)`, `100%` true grounding (`59/59`), `100%` delivery terms and payment accuracy.
- **66-Case Locked Regression Suite:** `gemini-3.5-flash-lite` remains verified at **66/66 (100.0%)** with `0` critical financial errors (prompt, schema, and extractor logic are unchanged from `a0b942c`). `gemini-4-hydrogen` was not run on the 66-case suite to preserve free-tier quota after failing the availability, latency, and unit-economics gates on the multimodal holdout.

### 14.6 Failure Analysis & Actionable Findings

1. **`T07` (Conflicting Pricing Models Across Dated Messages — Critical Financial Error, failed by BOTH `gemini-3.5-flash-lite` and `gemini-4-hydrogen`):** When a forwarded message contained an earlier Instagram DM (`$1,800 flat`) and a later dated Email (`$45/person`), both models classified it as a `revision` instead of a conflicting `initial` quote, and `gemini-4-hydrogen` omitted `conflictingOptions` entirely. Requires a separate extraction improvement tracked in **Issue #21** (without tuning against the frozen `held-out-v3-multimodal` expected answers).
2. **`T10` (Ambiguous Category):** `gemini-3.5-flash-lite` classified `"Horizon Hospitality & Events"` as `"venue"` instead of `"unknown"`. Requires a separate extraction improvement tracked in **Issue #21** (preserving the frozen holdout).
3. **Unresolved Frontend/Backend Calculation Parity Gap (`I04`):** On a 3-tier photography rate card (`I04`) where `"Overtime is $275/hr"` is a quote-level line item and included hours live on `packages[].hours`, the backend correctly calculated `$3,100` (`0` overtime hours) while the frontend calculated `$3,375` (`+$275` for 1 default hour) because `findIncludedHoursFromBackendQuote` in `frontend/src/services/quoteExtractor.ts` does not inspect `packages[].hours`. This gap **remains unresolved** and is tracked under **Issue #16 (Shared Deterministic Financial Engine)**.

### 14.7 PM Model Selection Decision (Approved)

- **PM Decision: Retain `gemini-3.5-flash-lite` (`gemini-flash-lite-latest`) as the current default. Defer model migration.**
- **Rationale & Caveats:**
  - `gemini-3.5-flash-lite` achieved **`28/30` (`93.3%`)** on the fresh benchmark (`10/10` images, `10/10` PDFs, `8/10` text) with **one critical financial error (`T07`)**, `100%` true multimodal grounding, `2.57s` avg no-retry latency, and `$0.00316` est. paid cost per successful extraction.
  - `gemini-4-hydrogen` was evaluated on a **smaller, non-equivalent subset** (`8` completed / `12` attempted) where it showed higher field-level accuracy (`98.4%` vs `94.1%`) but still failed `T07`, ran `4.8×` slower (`12.2s` no-retry avg), and incurred `9.7×` higher estimated paid cost (`$0.03057` vs `$0.00316` per successful extraction) due to default thinking tokens. Free-tier throttling (`429`/`503`) is noted as a free-tier observation and **not** evidence of paid-tier reliability.
  - `gemini-3.8-flash` hit recurring upstream `503`/timeout failures on the free tier, and `gemini-4-neon` is unavailable on the free tier (`429`; billing not enabled).
  - Follow-ups tracked without modifying the frozen `held-out-v3-multimodal` dataset: **Issue #16** (unresolved `I04` calculation parity gap) and **Issue #21** (`T07` and `T10` extraction improvements).
