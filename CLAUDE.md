# Purple Sector (lap timer)

Installable web app for timing drives on track days and rally events. React + TypeScript (Vite)
in `apps/web`, the pure timing engine in `packages/timing`, Firebase Auth + Firestore on the
Spark plan (no Cloud Functions), Firebase Hosting, Mapbox GL JS. The same build is also an
Android app (Capacitor, `apps/web/android`); native-only code sits behind `Capacitor.isNativePlatform()`.

Read before changing behaviour:
- `PLAN.md`: what the app does and why. Timing rules in section 4 (gates, starts, jump starts),
  **section 9 Decisions made** wins over anything older (e.g. sector colours), open questions in 10.
- `apps/web/PRODUCT.md`: users, the in-car vs paddock moments, design rules.
- `PERFORMANCE_PLAN.md`: performance work done and measured.
- `RACING_PLAN.md`: planned in-person racing (live gap between two cars); not built yet.

Commands (repo root): `npm test` (timing engine), `npm run test:rules` (Firestore rules, needs
Java 11+), `npm run build`, `npm run dev`. Typecheck: `npx tsc --noEmit -p apps/web`.
Deploy: `npx firebase deploy --only hosting` (plus `firestore:rules` / `firestore:indexes` when changed).
Pushing to main also deploys (`.github/workflows/deploy.yml`) and, when the app changed, builds the
signed APK and publishes it as the latest GitHub release (`android.yml`). After adding a Capacitor
plugin, run `npx cap sync android` in `apps/web` and commit the changed Gradle files.
