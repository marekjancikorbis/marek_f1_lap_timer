# Purple Sector (lap timer)

Installable web app for timing drives on track days and rally events. React + TypeScript (Vite)
in `apps/web`, the pure timing engine in `packages/timing`, Firebase Auth + Firestore on the
Spark plan (no Cloud Functions), Firebase Hosting, Mapbox GL JS.

Read before changing behaviour:
- `PLAN.md`: what the app does and why. Timing rules in section 4 (gates, starts, jump starts),
  **section 9 Decisions made** wins over anything older (e.g. sector colours), open questions in 10.
- `apps/web/PRODUCT.md`: users, the in-car vs paddock moments, design rules.
- `PERFORMANCE_PLAN.md`: planned performance work, in order.

Commands (repo root): `npm test` (timing engine), `npm run test:rules` (Firestore rules, needs
Java 11+), `npm run build`, `npm run dev`. Typecheck: `npx tsc --noEmit -p apps/web`.
Deploy: `npx firebase deploy --only hosting` (plus `firestore:rules` / `firestore:indexes` when changed).
