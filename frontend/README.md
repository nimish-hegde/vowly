# Vowly Frontend Prototype (`v0.4`)

React + TypeScript + Vite prototype of the Vowly wedding planning and financial decision workspace.

> **Mock mode only (`v0.4`):** Quote extraction runs locally via `SimulatedQuoteExtractor` in [`src/services/quoteExtractor.ts`](src/services/quoteExtractor.ts) with synthetic demo data (`Meera & Kabir — GTA 2027`). No API keys or backend server are required. Live integration with the backend extraction pipeline is planned for `v0.5`.

## Local setup

```bash
cd frontend
npm install
npm run dev
```

The dev server starts at `http://localhost:3000`.

## Scripts

- `npm run dev` — Start the Vite development server on port `3000`
- `npm run build` — Build the production bundle into `dist/`
- `npm run lint` — Type-check with `tsc --noEmit`
- `npm run preview` — Preview the production build locally
