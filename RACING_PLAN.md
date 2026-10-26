# Plan: in-person racing (live gap between two cars)

## Context

Purple Sector times solo drives against a reference lap (sector deltas at each gate). The user wants
two drivers on the same route to race in person, with the HUD showing the **live gap to the other
car**. A PWA can't link phones directly (no Bluetooth on iOS, no Wi-Fi Direct; WebRTC still needs
the internet), so the cars talk **through Firebase Realtime Database** (RTDB: free on Spark, billed
by bandwidth, 100 concurrent connections, built for frequent small updates; Firestore would burn
the 20k writes/day).

Decisions made with the user: **2 cars**, the host **picks the opponent from drivers they follow**
(the opponent gets a notification), and there is a **shared countdown** for side-by-side standing
starts (cars can still start on their own, e.g. rally-style intervals).

Deliverable of this planning step: this plan saved in the repo as **`RACING_PLAN.md`** (same style as
`PERFORMANCE_PLAN.md`: numbered steps, each one tested, committed, deployed, then a "Done" note).

## How the gap works (the core idea)

Compare **elapsed times at the same gate**, never wall clocks. Each car publishes its cumulative
minisector splits (`splitTimesMs`, already produced by `LapTimer` sector events in
`packages/timing/src/engine.ts`). At the latest gate `k` both cars have passed:
`gap = mySplit[k] − theirSplit[k]` (negative = I'm ahead). This is exact, matches the app's existing
gate-based sector deltas, needs no clock sync, and works for side-by-side and interval starts alike.
Between gates, the car ahead can show a "growing" estimate (`theirElapsedNow − mySplit[k]` once that
exceeds the last gap). The other car's distance along the route (`timer.distanceM`) is sent every ~2 s
for a "120 m ahead" line.

Only the **shared countdown** needs clocks: the host writes `goAt` in server time. Each phone converts
it with RTDB's `.info/serverTimeOffset` and calls the existing `controller.startCountdown(tap)` with
`tap = goAtLocal − countdownS·1000` (`apps/web/src/drive/controller.ts:408`, the engine computes
`goT = tap + countdownS`, `engine.ts:302`). The jump-start detection runs unchanged on each phone.

## Data model (RTDB)

```
races/{raceId}
  routeId, shapeVersion, hostId, guestId, createdAt (server time)
  status: 'invited' | 'lobby' | 'running' | 'done' | 'cancelled'
  goAt: number | null              // server ms, host only, shared countdown
  cars/{uid}
    name, joined: bool, phase      // 'waiting'|'ready'|'countdown'|'running'|'finished'|'invalid'
    splits: number[]               // cumulative ms, appended at each gate
    s, elapsedMs, at (server time) // live position, every ~2 s and at each gate
    totalMs, valid                 // at finish
```

Rules (`database.rules.json`): read only by `hostId`/`guestId`; the host creates the race with itself
as host; each driver writes only `cars/{auth.uid}`; only the host sets `goAt`/`status`; splits only grow
(append-only check against `data`); sizes capped. Races are short-lived: clean up `done` races older
than a day from the client on lobby open (shortcut until a server exists).

Invite: a new Firestore notification type `race` (`{ raceId, routeId, routeName }`) written by the host
into the guest's list, reusing `notify()` and the Notifications page. Rule: allowed only if the host
follows the guest (`exists(follows/{uid()}_{owner})`), same pattern as the `follow` notice.

## Steps (each: test, fix, commit, deploy; push only when asked)

**0. Save this plan** as `RACING_PLAN.md` in the repo root. **Done (2026-10-26).**

**1. Gap maths in the timing package** (pure, no Firebase).
- New `packages/timing/src/race.ts`: `raceGap(mySplits, theirSplits, myElapsedNow?, theirElapsedNow?)`
  → `{ gapMs, atGate, estimated }`, plus `isStale(at, now)`. Export from `index.ts`.
- Unit tests next to the existing timing tests (`npm test`): equal pace, overtaking mid-route,
  interval start (other car started 60 s later), other car not past my gate yet, finish.

**2. Realtime Database set-up.**
- User action: Firebase console → Realtime Database → Create (europe-west1, locked mode). Add
  `databaseURL` to `FIREBASE_CONFIG` (`apps/web/src/lib/config.ts`).
- `firebase.json`: `"database": { "rules": "database.rules.json" }`, emulator port 9000; connect the
  emulator in `apps/web/src/lib/firebase.ts` under `VITE_EMULATORS`.
- `firebase/database` is imported only inside the race module (dynamic import), so solo users don't
  download it; add it to the `firebase` manual chunk test in `apps/web/vite.config.ts` only if it lands there.
- RTDB rules + tests in `tests/` (`@firebase/rules-unit-testing` supports RTDB): strangers can't read,
  each car writes only itself, splits can't shrink, only the host sets `goAt`.
- `test:rules` script: add `database` to `--only`.

**3. Race lifecycle (`apps/web/src/lib/race.ts`).**
`createRace(route, opponent)`, `joinRace(id)`, `leaveRace(id)`, `watchRace(id, cb)`,
`publishCar(id, patch)`, `serverOffset()`. Host flow in **PreDrive** (`apps/web/src/screens/PreDrive.tsx`):
a "Race a friend" option listing drivers you follow (`followingIds` + `getProfiles` from `lib/data.ts`,
`Avatar`/`WhoText` from `components/ui.tsx`), which creates the race and sends the `race` notice.
Notifications page: a `race` notice opens `/race/{raceId}`.

**4. Lobby screen** (`apps/web/src/screens/RaceLobby.tsx`, route `/race/:raceId`).
Both drivers, their status (invited / joined / at the line / ready), the safety line
("Closed roads and tracks only"), and for the host: **Start together** (enabled when both cars report
`ready`, standing-start routes only) and **Go** (each starts on their own). Joining hands a
`DriveConfig` to Drive through the existing `setPendingDrive` (`apps/web/src/drive/store.ts`) with a new
optional `race: { id, opponentId, opponentName }`.

**5. Wiring the drive.**
In `DriveController` (`apps/web/src/drive/controller.ts`): when `cfg.race` is set, publish on each
`sector`, `started`, `finished`, `invalidated` event and every 2 s while running; watch the opponent's
car; compute the gap with `raceGap`; add `race: { gapMs, estimated, stale, opponentPhase, aheadM }`
to `DriveState`. Shared countdown: on `goAt`, schedule `startCountdown(goAtLocal − countdownS·1000)`.
Replay mode publishes too, so races can be desk-tested with simulated drives.

**6. HUD.**
In `apps/web/src/screens/Drive.tsx`: a gap readout (`−1.24 vs bob`, green when ahead, red when behind,
grey with "last seen 8 s ago" when stale > 5 s), in both display modes, plus the voice callout at
big sectors when voice is on (reuse the existing `say`). Keep the existing reference delta as the
secondary line.

**7. Results.**
Drive's finish view and `RunSummary` show both times and the final gap from the race record. Laps save
exactly as today (the race adds nothing to the run documents). Race status → `done`.

## Verification

- `npm test` (gap maths), `npm run test:rules` (Firestore + RTDB rules), `npx tsc --noEmit -p apps/web`,
  `npm run build` (check `firebase/database` is not in the main chunk; precache stays ≈1.27 MB).
- End to end on the emulators (`VITE_EMULATORS=1`, PhpStorm's Java 21): two isolated browser contexts
  via Chrome DevTools MCP, users seeded with rules-unit-testing; host invites guest, guest opens the
  notification, both join the lobby; run both in **replay** mode on the same route with different
  `speedKmh`/`sectorPace` (`SimOptions` in `packages/timing/src/simulate.ts`) and check the gap sign,
  size and the overtake; use "Start together" and check both countdowns end within ~100 ms; kill one
  context's network (DevTools offline) and check the stale state, then recovery.
- Never write test data to production.
- Real-world check by the user: two phones on a closed route.

## Out of scope (v1)

More than 2 cars, spectators/live map, race history and leaderboards for races, push notifications,
rolling-start shared countdown.
