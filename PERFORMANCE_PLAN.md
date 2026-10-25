# Performance Plan

How to make Purple Sector load faster and feel quicker, in the order to do it.
Two rules guide everything below:

- **Load what the user can see.** Data, images and code for things off screen, behind a
  tab or behind a tap wait until they are needed.
- **Load it once.** Data already fetched in this session is shown straight from memory,
  then quietly refreshed in the background.

Found by reading the code and the build output (2026-10-25), not by profiling on a phone.
Step 0 fills that gap.

---

## 0. Measure first (½ day)

Get numbers so every later step can show it helped.

- Chrome DevTools on a real Android phone (USB remote debugging), throttled to "Fast 4G":
  record a cold start, opening Feed, Drive and My Routes, and opening a lap.
- Note for each: time to first content, MB downloaded, number of Firestore reads
  (Firebase console → Firestore → Usage).
- Run Lighthouse (mobile) on the live site once, for a baseline score.

**Done when:** a short table of before-numbers is written at the bottom of this file.

---

## 1. Stop downloading every lap (biggest win, 1–2 days)

**Problem.** `allMyRuns()` (`apps/web/src/lib/data.ts`) fetches up to 500 of the user's
laps **in full**, each with its whole GPS `trace` and `profile` (thousands of numbers,
tens of KB per lap). It runs on every open of **Feed**, **Drive** and **My Routes**,
which only need each lap's route, time and date. It grows with every lap driven: at a
few hundred laps that is many MB per screen.

The Firestore web SDK can't fetch only some fields, so the heavy part has to live in a
separate document.

**Plan.**
1. New document `users/{uid}/runs/{runId}/detail/main` holding `trace` and `profile`.
   The run document keeps only the small fields (route, times, splits, flags).
2. Writing a lap (`saveRun` in `lib/data.ts`) writes both documents in one batch.
3. Only the screens that draw a lap read the detail: Lap Detail, Compare, Run Summary
   and lap playback. Add `getRunDetail(uid, runId)` next to `getRun` in `lib/data.ts`.
4. Security rules: `detail` is owner-only, same as the trace today. Add a rules test in
   `npm run test:rules`.
5. Migration script (one-off, run against the emulators first, then production):
   for each run with a `trace`, write the detail doc and delete the two fields
   from the run doc. Make it re-runnable (skip runs already migrated).
6. While migrating, readers fall back to the old fields if the detail doc is missing,
   so nothing breaks mid-migration. Remove the fallback once migration is done.

**Also consider:** Feed, Drive and My Routes only need "which routes have I driven" and
"my best per route". A small `users/{uid}/stats` document (`routeId → best ms, count`)
updated on each saved lap would replace the 500-lap query there completely.
`backfillActivity` already does this kind of summary for the heatmap.

**Done when:** opening Feed downloads a few KB of run data instead of MB, and the
Firestore reads per Feed open drop from "number of laps" to ~1.

**Done (2026-10-25), differently from points 5–6:** there are no admin credentials for a
server-side migration, so each user's app moves its own old laps as it lists them
(`moveDetails` in `lib/data.ts`, one run per commit, each queued once per session; the
rules only let the two fields go once the detail exists). The read fallback in `getRun`
stays, for laps of users who haven't opened the app since. Not done: the `stats` document,
so Feed, Drive and My times still read one (now small) document per lap.

---

## 2. Load only what is on screen (1 day)

### 2a. Map images in lists
`RouteShape` (`components/RouteShape.tsx`) asks for a Mapbox static map as soon as a
card renders, through `allowStaticMap`, which also **counts against the monthly
static-map quota**. Every card that renders spends one, including the 20 cards of each Feed page
below the screen, even if the user only looks at the top three.

- Render the SVG shape at once (already there) and ask for the map image only when the
  card scrolls near the screen: an `IntersectionObserver` with `rootMargin: '300px'`
  in `RouteShape`, so every list (Feed, My Routes, Drive, User page) gets it at once.
- Add `loading="lazy"` and `decoding="async"` to the `<img>`.

### 2b. Paging lists
- The Feed already pages 20 at a time (`feedPage`). The empty-state "suggested drivers"
  (`Feed.tsx`) reads the newest 100 posts to find route leaders: fine for now, but it
  grows with the number of posts. Replace with a small `routeLeaders` summary later.
- The route list on the map screen loads up to 500 public routes at once (`limit(500)`):
  page or load by map viewport once there are many routes.

### 2c. Tabs and expandable parts
- Lap Detail and Compare: fetch data for the **Graphs** and **Map** tabs when the tab is
  first opened, not with the page. Sectors (the default tab) needs only splits.
- Expandable sections (e.g. route map on profiles, big sectors in Compare) fetch on
  first expand.

**Done when:** scrolling the top of the Feed uses only as many static maps as cards seen,
and opening a lap loads only the open tab's data.

**Done (2026-10-26):** 2a in `RouteShape` (only My times → Routes I built uses map pictures
today; 16 cards → 4 pictures at the top). 2c: the Mapbox map already mounted on first
Graphs/Map tap; now the compared lap's detail also loads then (`onOpen` on `LapView`).
Run Summary still loads its own lap's trace up front: the map draws it once, on load.
Compare not changed (it picks laps explicitly). 2b left for later, as planned.

---

## 3. Keep loaded data cached (1–2 days)

**Today.** Firestore's persistent cache is on (`lib/firebase.ts`), but `getDoc`/`getDocs`
always wait for the server when online. The cache only helps offline. Going
Feed → Lap → back to Feed fetches everything again and shows a spinner each time.

**Plan.** A small in-house cache instead of a new library:

1. `lib/cache.ts`: a `Map` from a key (e.g. `route:${id}`, `posts:feed`) to
   `{ value, at }`, plus a `useCached(key, loader)` hook:
   - cache hit: return the value straight away, no spinner;
   - if older than ~60 s, call `loader` in the background and update the screen when it
     returns ("stale while revalidate");
   - cache miss: load with a spinner as today.
2. Use it for data that rarely changes and is opened often: routes (`getRoute`),
   profiles (`getProfile`, `getProfiles`), a run and its detail, the Feed's first page.
3. Clear or update the matching key after a write (posting a lap, editing a route,
   deleting a run), so the user never sees their own change missing.
4. Clear the whole cache on sign-out.
5. For a fast first paint after a cold start, try `getDocsFromCache` first and then the
   server for the Feed. The persistent cache already holds the last Feed.

Run documents never change after they are saved, and a route's shape is versioned
(`shapeVersion`), so those can be cached for the whole session without refreshing.

*Alternative:* TanStack Query does all of the above (and more) for ~13 KB. Worth it only
if the hand-rolled cache grows past ~100 lines.

**Done when:** going back to a screen already seen shows it instantly, with no spinner.

**Done (2026-10-26), smaller than planned:** the cache lives inside `lib/data.ts` (`cached`,
`forget`, `clearCache`), around the read functions, so no screen changed. Every write function
forgets the keys it touches; the session clears it on sign-in/out; the Feed's pull to refresh
and new-laps pill skip it. Entries expire after 60 s and are then fetched again (no background
refresh while showing the old value). Point 5 (`getDocsFromCache` on cold start) not done.
Back to a seen tab, 200 laps: My times 845 → 53 ms, Drive 849 → 88 ms.

---

## 4. Smaller first download (½ day)

**Problem.** The main JavaScript bundle is **813 KB**. `Feed`, `AuthScreen` and
`Onboarding` are imported directly in `App.tsx`, so they and everything they use
are in it, along with Firebase.

- Lazy-load `Feed`, `AuthScreen`, `Onboarding` and `LimitScreen` with `lazy()`, like the
  other screens in `App.tsx`.
- Run `npx vite-bundle-visualizer` once to see what else ended up in the main chunk.
- Firebase: keep only `app`, `auth` and `firestore`, and never import the whole
  `firebase` package.

**Done when:** the main chunk is under ~400 KB.

**Done (2026-10-26):** Feed, Auth, Onboarding and LimitScreen are lazy (saved only 26 KB: the
rest was libraries). By source, the old 788 KB main chunk was Firestore 349 KB, react-dom 128 KB,
Auth 122 KB, WebChannel 51 KB. Every signed-in screen needs those at once, so they moved to
their own chunks (`manualChunks` in `vite.config.ts`): main 36 KB, `firebase` 585 KB,
`react` 166 KB. Same first download, fetched in parallel; and since those two keep their
names across deploys, an update now re-downloads ~36 KB of app code instead of ~790 KB.

---

## 5. Lighter background download (½ day)

**Problem.** On first install the service worker precaches **~3.2 MB**, including the
**1.9 MB** map library (`MapView-*.js`). On mobile data that competes with the first
screen.

- In `vite.config.ts` → `workbox`, add `globIgnores: ['**/MapView-*.js', '**/MapView-*.css']`.
- Add a `runtimeCaching` rule (`CacheFirst`) for those files, so the map library is
  cached the first time a map is opened and works offline afterwards.

**Done when:** first-install precache is under ~1.5 MB.

---

## 6. Fonts (small, 1 hour)

Six font weights load (Barlow 400/500/600, Barlow Condensed 500/600/700). Only `.woff2`
files are precached, so the `.woff` copies cost nothing.

- Check which weights are really used. Dropping one or two saves ~22 KB each.
- Add `font-display: swap` if text ever shows blank while fonts load (fontsource sets it
  by default; verify).

---

## Order and effort

| # | Step                         | Effort   | Gain                                   |
|---|------------------------------|----------|----------------------------------------|
| 0 | Measure                      | ½ day    | Know what to fix                       |
| 1 | Split run trace out          | 1–2 days | Biggest: MB → KB on main screens       |
| 2 | Load only what's on screen   | 1 day    | Faster lists, fewer static-map charges |
| 3 | Cache loaded data            | 1–2 days | Instant back-navigation                |
| 4 | Smaller main bundle          | ½ day    | Faster cold start                      |
| 5 | Lighter precache             | ½ day    | Faster first install on mobile data    |
| 6 | Fonts                        | 1 hour   | Small                                  |

Each step ships on its own (commit, build, deploy) and is measured against step 0.

## Risks

- **Step 1 changes stored data.** Back up Firestore (`gcloud firestore export`) before
  the migration, run it on the emulators first, and keep the read fallback until it is
  done.
- **Step 3 can show stale data.** Every write must update or clear its cache key. Test
  posting, editing and deleting after each change.

## Measurements

Step 0 baseline, 2026-10-25. Desktop Chrome emulating a phone (412 px, 4x CPU slowdown,
"Fast 4G"), not a real phone. Signed-in screens ran against the local emulators with a
seeded driver who has 200 laps (`node scripts/seed-perf.mjs 200`, 10 Hz traces of a 2 min
lap). Times are from tapping the tab until the spinner is gone.

| What                                   | Before                       | After |
|----------------------------------------|------------------------------|-------|
| Cold start, signed out (live site)     | FCP/LCP 1.3 s, 275 KB        |       |
| Main JS chunk                          | 813 KB (215 KB gzip)         | 36 KB + firebase 585 KB + react 166 KB (step 4) |
| Service worker precache                | 3.18 MB, 52 files            |       |
| One run document on the wire           | ~65 KB trace + ~3 KB profile |       |
| Data per Feed / Drive / My times open  | ~13 MB (200 full laps)       | ~0.1 MB (step 1) |
| Firestore reads per open of those      | 200 (one per lap)            | 200 (stats doc not done) |
| My times, 200 laps                     | 11.4 s first, 44 s again     | 1.1 s (step 1), 53 ms again (step 3) |
| Drive, 200 laps                        | 40 s                         | 1.1 s (step 1) |

Not measured: a real phone, the live Firestore usage page, Lighthouse performance score
(the DevTools tool here leaves performance out).
