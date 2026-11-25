# Vowly

An AI-powered wedding planning workspace for couples to compare vendor offers, manage budgets, make joint decisions and coordinate responsibilities.

**Current stage:** `v0.4` — Interactive React frontend prototype (`frontend/`, mock mode) integrated alongside the `v0.3` AI quote extraction pipeline and eval harness.

Vowly starts with vendor decision-making. Capture a quote, compare it with another offer, review revisions against source evidence, and track commitments and follow-ups across wedding events.

## Repository layout

- `src/`, `eval-data/`, `ui/` — `v0.3` backend extraction pipeline, deterministic financial calculator, quote review safeguards, telemetry, 60-case eval harness, and local Quote Review UI (`npm run ui`).
- `frontend/` — `v0.4` React + TypeScript + Vite + Tailwind CSS v4 interactive prototype (running in local mock mode).
- `docs/` — Product specification and AI extraction evaluation reports.

## Frontend architecture (`v0.4`)

The prototype in [`frontend/`](frontend/README.md) is organized into four layers:

- **Views & modals (`frontend/src/components/`)**: `AppShell`, `OverviewView`, `EventsView`, `BudgetView`, `VendorsView`, `VendorComparisonView`, `PaymentsView`, `VendorDetailDrawer`, `QuoteImportModal`, `BookingModal`, `OnboardingFlow`, and `QuickModals`.
- **Workspace state (`frontend/src/store/workspaceStore.tsx`)**: Client-side React Context store seeded with a synthetic multi-event GTA wedding workspace (`frontend/src/data/demoWorkspace.ts`) and persisted in browser `localStorage`.
- **Financial engine (`frontend/src/engine/financialCalculator.ts`)**: Per-person, minimum-guest-floor, guest-ratio, and flat-fee calculations with Ontario HST handling, add-ons, and approval gating for unconfirmed mandatory fees and price conflicts.
- **Extraction adapter (`frontend/src/services/quoteExtractor.ts`)**: Defines `QuoteExtractionAdapter` and currently uses `SimulatedQuoteExtractor` (presets + local heuristics) so the prototype runs completely offline without API keys.

## Local setup

**Prerequisites:** Node.js `>= 22.18.0`

### Run the `v0.4` frontend prototype (mock mode)

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`. No API keys or backend server are required in mock mode.

To type-check and build the frontend:

```bash
cd frontend
npm run lint
npm run build
```

### Run offline backend tests & evals (`v0.3`)

From the repository root:

```bash
npm test
npm run eval -- --provider mock
```

To launch the standalone `v0.3` Quote Review UI:

```bash
npm run ui
```

## Current limitations (`v0.4`)

- **Mock extraction only:** `frontend/` uses `SimulatedQuoteExtractor` and does not call the `v0.3` Gemini/Ollama extraction backend yet.
- **Browser-only persistence:** Workspace edits live in `localStorage` with no multi-user backend sync, authentication, or real-time partner collaboration.
- **Synthetic demo data:** All preloaded venues, vendors, quotes, and contacts (`Meera & Kabir — GTA 2027`) are fictional examples modeled on typical wedding pricing patterns.
- **Unbundled calculator logic:** `frontend/src/engine/financialCalculator.ts` is currently separate from the `v0.3` backend calculator (`src/calculator.ts`).

## Planned integration (`v0.5`)

- Connect `QuoteExtractionAdapter` in `frontend/src/services/quoteExtractor.ts` to the `v0.3` extraction backend (`src/extractor.ts`, `src/validator.ts`, `src/review.ts`, and `src/telemetry.ts`).
- Unify financial calculation and approval-gate rules between frontend and backend so multi-currency totals, source-excerpt verification, mandatory TBD blocking, and price-conflict resolution share a single source of truth.
- Introduce backend persistence and partner workspace sharing for the private pilot.

## Project documentation

- [Product requirements and design concepts](docs/PRODUCT_SPEC.md)
- [AI quote extraction eval report (`v0.3`)](docs/EVAL_REPORT.md)
- [Frontend prototype README](frontend/README.md)
- [Changelog](CHANGELOG.md) · [Pilot backlog](https://github.com/nimish-hegde/vowly/issues)

The design concepts, demo workspace, and test quotes use fake data modeled on real wedding pricing patterns. The pilot will test the vendor workflow with self-planning couples before expanding the product.
