---
name: vowly-ai-eval
description: >-
  Runs Vowly's AI quote extraction evaluation loop: benchmark, failure analysis,
  targeted fix, and retest. Use when evaluating Gemini or Ollama extraction quality,
  investigating extraction failures, or adding evaluation cases.
---

# Vowly AI Evaluation Workflow

Follow this four-step loop (`benchmark → failure analysis → fix → retest`) whenever evaluating or improving AI quote extraction.

## 1. Benchmark

1. Run offline mock verification first to validate grading and schema wiring at zero API cost:
   - `npm test`
   - `npm run eval -- --provider mock`
2. When `GEMINI_API_KEY` is configured server-side (never print or commit it), run live evaluations:
   - Targeted split: `npm run eval -- --provider gemini --split dev --show-raw`
   - Full suite: `npm run eval -- --provider gemini --show-raw`
3. Record exact **resolved model version** and **dataset version/split counts**. Never silently fall back to `mock` when live evaluation is requested.
4. **Holdout integrity:** Never edit locked `eval-data/regression/`, `eval-data/held-out/`, or `eval-data/held-out-v2/` cases to make a change pass. Add new cases to `eval-data/dev/cases.json` or a new versioned holdout split.

## 2. Failure Analysis

Classify every failure by root-cause layer (`prompt/model`, `schema`, `validator`, `calculator`, or `UI`) and track all required metrics:
- **End-to-end accuracy** (overall and per split/category)
- **Field-level accuracy** (currency, category, pricing type, minimums, ratios, tax/gratuity, inclusions, payment terms)
- **Source grounding** (verbatim excerpts for text; visible snippets + page references for images/PDFs)
- **False positives** (fabricated fees, false price conflicts, invented vendor names/locations)
- **Missed mandatory charges** (dropped TBD fees, unknown gratuity %, unpriced conditional charges)
- **Critical financial errors & unsupported currency guesses** (immediate **release blockers**)
- **Human correction rate** (from `src/telemetry.ts` during review sessions)
- **Reliability & cost:** API availability, schema validity, retries, latency (including and excluding retries), token usage, and **cost per successful extraction** (plus cost per accepted quote when review telemetry is available)

## 3. Targeted Fix

1. Fix the root cause at the right layer (prefer deterministic validation/calculation fixes over prompt hacks where possible).
2. Add a focused offline unit test in `src/` (and a frontend parity test if calculation or mapping changed).
3. Add a representative `dev` eval case if the failure pattern is not yet covered.

## 4. Retest & Record Evidence

1. Re-run `npm test` and `npm run eval -- --provider mock`.
2. Re-run live Gemini evaluations (`npm run eval -- --provider gemini`) and compare directly against the previous baseline in `docs/EVAL_REPORT.md` to confirm zero regressions on locked splits.
3. Report **live model results separately from mock results** in `docs/EVAL_REPORT.md` and `docs/ROADMAP.md`.
