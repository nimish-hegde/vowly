---
name: vowly-feature-dev
description: >-
  Guides Vowly feature development from requirements and measurable acceptance criteria
  through root-cause analysis, planning, focused implementation, parity testing, and PR creation.
  Use when starting a new Vowly milestone, feature, or non-trivial bug fix.
---

# Vowly Feature Development Workflow

Follow this three-stage procedure (`requirements → plan → implementation`) for every feature or non-trivial fix in Vowly.

## 1. Requirements & Codebase Audit

1. Read `AGENTS.md`, `docs/ROADMAP.md`, and the relevant section of `docs/PRODUCT_SPEC.md`.
2. Verify current git branch and open PR status before creating a new feature branch from updated `main` (unless explicitly stacking).
3. Inspect the actual code across backend (`src/`) and frontend (`frontend/src/`) before forming hypotheses. Never assume information missing from the UI is missing from the model response.
4. Define **measurable PM acceptance criteria** and explicit **non-goals** before coding.
5. Identify the simplest user-controlled path first. Limit automation to common, unambiguous cases and defer rare cases until pilot feedback justifies them.

## 2. Plan & Orchestration

1. Present a short **root-cause analysis / implementation plan** mapping each issue or requirement to its exact layer:
   - Model/prompt (`src/extractor.ts`)
   - Schema/validator (`src/types.ts`, `src/validator.ts`)
   - Deterministic calculator (`src/calculator.ts`, `frontend/src/engine/financialCalculator.ts`)
   - Store/safeguards (`src/review.ts`, `frontend/src/store/workspaceTransitions.ts`)
   - UI/adapter (`frontend/src/components/`, `frontend/src/services/`)
2. For complex or multi-layer scope, delegate bounded work to specialized subagents (Extraction Specialist, Financial Engine Specialist, Frontend UX Specialist, QA & Release Verifier) with explicit file ownership and deliverables. The primary agent owns integration and final verification.
3. Get user/PM confirmation on the plan and acceptance criteria before making code edits.
   Include the manual override or fallback where appropriate, the clarification required for uncertain facts, and the existing components and data paths the change will reuse. Scope the PR to the acceptance criteria and justify any architecture change in the plan.

## 3. Focused Implementation & Verification

1. Enforce core Vowly invariants:
   - AI extracts facts only; deterministic code calculates all financial outcomes.
   - Maintain backend/frontend calculation parity via shared helpers or identical test fixtures.
   - Preserve all four financial states (`Draft` → `Reviewed` → `Booked` → `Paid`), draft isolation, booking/approval blockers, and unpaid-by-default deposits.
   - Never commit API keys, credentials, or personal wedding data, and never silently fall back to mock on live extraction failures.
2. Add focused unit tests and parity regression fixtures covering the new behavior and relevant edge cases. When the change affects recovery or financial decisions, verify the manual path, source retention, protection of existing data, and explicit approval before financial state changes.
3. Run the full offline verification suite before pushing:
   - `npm test`
   - `npm run eval -- --provider mock`
   - `cd frontend && npm test && npm run lint && npm run build`
4. Open a PR using `.github/pull_request_template.md` with clear verification results, separating offline/mock results from pending live verification. **Do not merge without explicit PM approval.**
