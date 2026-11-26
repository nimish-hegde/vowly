---
name: vowly-docs-sync
description: >-
  Synchronizes Vowly documentation after feature work, eval runs, or releases:
  updates the living roadmap and decision log, changelog, evaluation report,
  and README without duplication or overstatement. Use after completing a milestone or eval cycle.
---

# Vowly Documentation Sync Workflow

Keep Vowly's project documentation accurate, factual, and non-duplicative.

## Document Ownership (Single Source of Truth)

| File | Owns | Do Not Duplicate Here |
|---|---|---|
| `README.md` | Current stage, repo layout, local setup commands, current limitations, links to docs. | Full benchmark tables or detailed decision histories. |
| `docs/ROADMAP.md` | Living milestone & PM acceptance-criteria tracker, UX/unit-economics targets, and versioned decision log (hypotheses, changes, eval outcomes, failures, trade-offs, cost per accepted quote, ship/hold decisions). | Per-case raw eval logs or line-by-line PR diffs. |
| `docs/EVAL_REPORT.md` | Exact live vs. mock benchmark results, resolved model & dataset versions, failure breakdowns, latency/retry/token/cost metrics. | General product roadmap. |
| `CHANGELOG.md` | Concise dated user-facing summary of shipped milestones with PR links and headline measured results. | Unverified claims or planned-only work. |
| `docs/PRODUCT_SPEC.md` | Product requirements, pilot scope, user workflows, and status definitions. | Transient debugging notes. |

## Sync Checklist

1. **Roadmap & Decision Log (`docs/ROADMAP.md`):**
   - Update milestone status and Ship / Hold gate.
   - Add a versioned decision entry (`D-XXX`) for significant product, architecture, or model decisions covering hypothesis, change, measured results, failures, trade-offs, and ship/hold decision.
   - Update cost per successful extraction / cost per accepted quote when new live telemetry is recorded.
2. **Evaluation Evidence (`docs/EVAL_REPORT.md`):**
   - Clearly separate **live model results** from **offline mock results**.
   - Record exact resolved model version, commit SHA, dataset split sizes, and remaining known failures.
3. **Changelog & README (`CHANGELOG.md`, `README.md`):**
   - Add shipped user-facing changes to `CHANGELOG.md` with PR link and verified numbers.
   - Update `README.md` if setup commands, repo layout, current stage, or limitations changed.
4. **Honesty Check:**
   - Never overstate mock results as live readiness.
   - Explicitly list unresolved issues and deferred follow-up work.
