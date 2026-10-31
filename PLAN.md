# Lap Timer: Project Plan

A mobile app for timing drives on routes you define yourself, racing against your
own earlier times, and competing with other drivers on routes they publish. It ships as an
installable web app (PWA) and as an Android app built from the same code.

**Only approved users can create routes.** An admin grants that permission from the admin screen. Everyone else can still drive public routes and appear on their leaderboards.

---

## 1. Feature summary

| Area | What it does |
|---|---|
| **Roles and permissions** | Four roles. A **driver** (every new account) can drive public routes, race their own times and appear on leaderboards. A **creator** can also build routes and publish one; an admin grants this. An **admin** grants and revokes creator access, moderates public routes and posts, and can publish up to 5 routes. The **owner** is an admin who also grants and revokes admin. |
| **Route builder** | *Creators and up.* Draw a route on a map, snapped to roads. It can be point-to-point or a **lap** (loop, where start = finish). Choose a **sector length** (50–1000 m) and a **standing** or **rolling** start. |
| **Routes tab** | **My laps**: the routes you've driven, with your PB. **Routes I built**: your routes, each private unless you make it public (creators get one public route). Drivers can request creator access there. |
| **Drive** | Pick a route and a lap to race against (the reference), then drive. Times are taken from GPS crossings of the start, sector and finish gates. |
| **Drive screen** | **Full HUD**: three big sectors over a line of minisectors, the delta and the running time. **Delta only**: the delta fills the screen and the background shows how the last minisector went. Turning the phone sideways switches to delta only. |
| **Delta logic** | The delta updates only when you **cross the end of a sector**: your elapsed time at that sector boundary minus the reference lap's elapsed time at the same boundary. |
| **Social feed (home)** | Your home course, then the **posted laps of everyone you follow**, newest at the top, with **Race this lap** and **Compare** buttons. |
| **Following** | Follow and unfollow anyone from their user page. Follower and following counts and lists are on every profile. |
| **Explore** | A map of every public route, with one search for routes and drivers. Tapping a route opens its page and leaderboard. |
| **Posting laps** | Laps are private by default. On a public route you can **post** a valid lap, which puts it on the route's leaderboard, in followers' feeds and on your profile. You can remove a post at any time. |
| **Lap comparison** | Put any two laps on the same route side by side: your own laps, another person's posted lap, your theoretical best or the route record. Sectors, a delta graph, a speed graph and a map coloured by who was faster. |
| **Profiles** | Photo (checked on the phone before upload), display name and @username, home course, activity heatmap, and **Posts / Routes / Laps** tabs. |
| **Notifications** | New followers, someone beating your time, decisions on access requests, and moderation news. |
| **Android app** | The same app in a native shell, downloaded from the PWA. It keeps timing with the screen off (background GPS) and uses Android's own Google sign-in and share sheet. |

---

## 2. Tech stack

React + TypeScript (Vite), Firebase Auth + Firestore (Spark plan, no Cloud Functions),
Firebase Hosting, Mapbox GL JS. The web build is installable (PWA) and is also wrapped by
**Capacitor** into the Android app. See *Platform and backend* in section 9 and `apps/web/PRODUCT.md`.

```
apps/web/            the app (screens, map, drive HUD)
apps/web/android/    Capacitor's Android project (built in CI, not by hand)
packages/timing/     pure TS timing engine + unit tests + GPS fixtures
firestore.rules      security rules (tests in tests/)
.github/workflows/   deploy.yml: rules + hosting on push to main;
                     android.yml: signed APK published as a GitHub release
```

---

## 3. Core concepts and data model

### Route (`routes/{id}`)
- `coords`: an ordered polyline. **Direction matters**, so it runs from start to finish.
- `isLoop`: if true, the finish gate is the start gate and laps run back to back.
- `sectorLengthM`: 50–1000 m, in steps of 50 m.
- `boundaries[]`: the distances along the route where each sector (minisector) ends. These are **computed once and frozen** when the route is saved. Example: a 2,300 m route with 500 m sectors has boundaries `[500, 1000, 1500, 2000, 2300]`. If the last sector would be shorter than half a sector length, it is merged into the previous one.
- **Big sectors**: three groups of minisectors, ending at the minisector ends closest to the route's thirds (`bigSectorEnds` in `packages/timing`). The HUD, lap cards and records show these.
- `startType`: `standing` | `rolling`.
- Once a route has laps, its shape and sectors can't change in ways that make old times incomparable.

### Run (`users/{uid}/runs/{id}`)
- `splitTimesMs[]`: elapsed time at each sector end. Sector times are the differences between consecutive splits.
- `totalMs`, `penaltyMs`, `valid`, `partial`, and the GPS quality.
- The raw GPS `trace` and the distance-indexed `profile` (time and speed every 10 m) live in a separate document, `…/runs/{id}/detail/main`, so lists don't download them. Only the owner can read either.
- On loop routes, each lap is its own run.

### Other collections
- `posts/{runId}`: a posted lap (copy of its times, caption, car, PB flag), read by everyone signed in. Leaderboards and the feed are built from posts.
- `users/{uid}/stats/routes`: per route you've driven, the lap count, last time, PB and whether you've posted. Feed, Drive and Routes read this one document instead of every lap.
- `roles`, `roleAudit`, `creatorRequests`, `adminRequests`: who may do what, and the log of every grant.
- `follows`, `notifications/{uid}/items`, `activity/{uid}` (heatmap), `usernames`, `avatars`, `usage/{period}` (Mapbox counters).

### Roles and permissions
| Role | How you get it | What it allows |
|---|---|---|
| `driver` | Every new account | Follow people, see the feed, browse Explore. Drive **public** routes, keep your own laps and post them. |
| `creator` | An **admin grants it**, usually after a request | Everything a driver can do, plus build private routes and publish **one**. |
| `admin` | The **owner grants it**; creators can request it | Grant and revoke `creator`, decide creator requests, hide or unpublish any public route, remove posts. Up to 5 public routes, shown as Official. |
| `owner` | Set once **directly in the database** | Everything an admin can do, plus grant and revoke `admin`. No public-route limit. |

- **The server enforces everything**, not just the app UI. The Firestore security rules refuse a route from anyone who isn't a creator, even if someone calls the API directly.
- **Users can never change their own role.** Roles live in a separate `roles` collection that only admins can write to, and every grant must come with a `roleAudit` entry.
- **Revoking creator access**: the user can no longer create or publish routes. Their existing routes and runs stay, so other people's leaderboard times are not lost.
- **Requesting access**: a driver taps "Request creator access" (Routes tab) with an optional note; the admin approves or rejects it in the admin screen, and the driver gets a notification.

Who can read and write what is enforced by `firestore.rules` (tests: `npm run test:rules`).
Raw GPS traces stay private to their owner; others see only posted laps.

---

## 4. Timing engine (`packages/timing`)

The engine is a pure class with no UI (`LapTimer` in `engine.ts`). It takes a stream of GPS fixes `{lat, lon, t, accuracy, speed, heading}` and accelerometer samples, and emits events such as `armed`, `countdown`, `started`, `jumpStart`, `sector`, `lapComplete`, `finished` and `invalidated`.

### 4.1 Where am I on the route?
1. Before the drive, resample the route polyline every ~2 m and record the cumulative distance at each point.
2. Project each GPS fix onto the polyline to get **`s`** (distance along the route) and **`e`** (lateral offset from the line).
3. Only search a **window** around the last known `s` (from slightly behind to a little ahead, scaled by speed). This handles routes that cross themselves and loops where start and finish are the same point.
4. If `e` stays above ~30 m for more than a few seconds, you are off route and the run is invalidated. Fixes with poor accuracy are flagged and lower the run's quality.

### 4.2 Precise gate crossings
Phone GPS usually updates at **about 1 Hz**, which at 100 km/h means a fix only every ~28 m. Taking the timestamp of the fix after the line would therefore be off by up to a second. Instead, the engine interpolates:

```
if s_prev < boundary <= s_curr:
    t_cross = t_prev + (boundary - s_prev) / (s_curr - s_prev) * (t_curr - t_prev)
```

- Use **GPS fix timestamps**, not the time JavaScript received the fix.
- Measured accuracy is in section 9 (*Gate accuracy*). An external 10–25 Hz Bluetooth GPS would be a later upgrade (section 8).

### 4.3 Starts
- **Rolling**: the timer arms when you are within ~50 m of the start and heading in the route's direction. It starts when you cross the start gate, which is a line perpendicular to the route at its first point, using the same interpolation.
- **Standing (countdown start)**:
  1. You stop within ~15 m of the start. The engine confirms you are stationary, then enables the **Start countdown** button. This is the only tap during a run, and it happens while the car is stopped.
  2. A **countdown of 3–10 s** runs. You set its length on the pre-drive screen; the default is 5 s.
     - The timing is **exact and even**: one beat per second with no random hold, so GO always comes exactly N seconds after the tap.
     - It shows as large numbers plus an F1-style row of lights, with a beep each second and a different tone on GO.
     - The GO instant is on the GPS time base, so it lines up with the fix timestamps used for the gates.
  3. **The lap is timed from the moment the car moves off** after GO, so a slow launch costs nothing. Reaction time is not part of the lap and is not shown.
  4. **Jump start: a +5 s penalty**, applied only when the car has really moved **more than 10 m forward before GO** (see 4.3.1). Smaller movements are ignored.
     - A jump-started lap is timed from GO, and the penalty is added to sector 1, so every split, delta, colour and the final time include it. A jump can never earn a purple sector or a better delta.
     - The run keeps going. The HUD shows a red **"JUMP START +5.0 s"** banner for a few seconds.
     - Penalised runs are still **valid**. They count on the leaderboard with the penalty included and can be used as a reference.
     - The countdown can be cancelled before GO with no penalty.

#### 4.3.1 Jump-start detection without false penalties
GPS **position** is the unreliable part. A phone sitting still often shows its position wandering 3–10 m (or more near buildings and trees). Comparing raw positions against a 10 m threshold would therefore produce false penalties. Instead, the engine estimates the distance moved before GO **from signals that don't drift**:

1. **Anchor**: during the stationary check and the countdown, average the GPS fixes to get one stable start position. The accelerometer baseline (gravity and phone mount angle) is captured at the same time.
2. **Is the car really moving?** Motion counts only when **both** of these agree:
   - **Accelerometer**: sustained forward acceleration above ~0.1 g for more than 300 ms, after a low-pass filter. Engine revs, door slams and phone taps are short spikes and get filtered out.
   - **GPS Doppler speed** (the fix's `speed` field) above ~1.5 m/s. Speed comes from the Doppler shift of the satellite signals, not from position differences, so it stays near zero while the car is stationary even when the reported position is wandering.
3. **How far before GO?** Once motion is confirmed, the distance travelled up to GO is the **integral of Doppler speed over time**. Only movement **forward along the route** counts, so rolling back on a hill is never penalised.
4. **Decision**: a penalty applies only if the integrated distance is **> 10 m**. If the GPS reports poor accuracy during the countdown and the signals disagree, **no penalty is given**: the driver gets the benefit of the doubt.

The 10 m threshold is a setting in the engine (`JUMP_START_THRESHOLD_M`). Because the method doesn't rely on raw positions, it could be lowered later without causing false penalties.

### 4.4 Delta and colours
```
split_k   = t_cross_k - t_start                    // elapsed at sector end
sector_k  = split_k - split_(k-1)
delta_k   = split_k - ref.splitTimesMs[k]           // negative = ahead
```
Colours are defined in *Sector colours*, section 9. Records and PBs are **downloaded before the drive**, so colours work offline.

### 4.5 Laps
On loop routes, crossing the finish gate completes the lap and immediately starts the next one at the same instant. Each lap is compared against the selected reference lap. Laps continue until the driver holds **Finish session**.

### 4.6 Comparing laps (after the drive)
Two laps can be compared only on the **same route**, so they share the same frozen sector boundaries. The comparison code lives in `packages/timing` (`compareLaps(a, b)`).

**What lap B can be:**
- Another one of **your own laps**.
- **Someone else's posted lap**: from the leaderboard, their profile or the feed.
- **Your theoretical best**: the sum of your best time in each sector.
- **The route record**: the sum of the purple sectors.

**What the comparison shows** (Sectors / Graphs / Map tabs):

| View | Data used |
|---|---|
| **Header** | Both total times, the gap, and penalties shown separately. |
| **Sectors** | The three big sectors, each expandable into its minisectors, with A and B times and the difference. Purple marks a route record. |
| **Graphs** | Cumulative gap against **distance along the route** (from the 10 m profiles, so it shows exactly *where* time is gained or lost), and both speed traces overlaid. |
| **Map** | The route coloured per sector by who was faster, with playback that moves both laps along the route. |

Raw GPS traces of other users are never needed: comparisons use only the distance-indexed profiles.

**Racing against someone else's lap:** any posted lap on a route can be chosen as the **reference for a drive**. The live delta then compares you against that person's splits.

### 4.7 Social feed
- **Content**: every visible post (on a public route that isn't hidden) by users **you follow**, newest first.
- **Query**: built **when it is read**: posts where `userId` is in your follows, 20 at a time (Firestore `in` takes at most 30 ids, so follows are queried in chunks of 30: `feedPage` in `lib/data.ts`).
- **Freshness**: pull to refresh. While the app is open, a Firestore listener watches for new posts from people you follow and shows a **"new laps"** pill that loads them at the top.
- **Consistency**: unfollowing someone, deleting, unposting or moderating a post removes it from the feed at once, because the feed is computed on read.
- **Scaling later**: if follow counts grow very large, write each post into followers' feeds at post time instead. Needs a server; not needed now.

---

## 5. Screens

**Navigation (bottom tabs):** Feed · Explore · **Drive** (raised, in the middle) · Routes · Profile.
Admin is a shield icon on your own profile, shown only to admins.

1. **Auth**: email and password, or Google, then choose a username (onboarding). New accounts are **drivers**. The sign-in screen also offers *Add to home screen* and, on Android, *Get the Android app*.
2. **Feed (home)**: your home course card (route, your PB), then posted laps from people you follow with pull to refresh and a "new laps" pill (4.7). Each lap card shows the author, the **big lap time**, a New PB or jump-start badge, the route's shape painted in big-sector colours, caption and car, and **Race this lap** and **Compare** (only if you've driven the route).
   **Empty state**: a "Find drivers" button that opens Explore, plus suggested drivers (route leaders) with Follow buttons.
3. **Explore**: a full-screen map that stays loaded in the background, so the tab opens instantly. Public routes show as clustered start pins zoomed out and as lines zoomed in. One search finds routes and drivers, with results in a draggable sheet. Tapping a route opens **Route detail**.
4. **Route detail**: a map header, length, sector count, start type and owner, the big-sector records, and tabs: **Leaderboard** (each driver's best posted lap), **My laps** and **Locals** (drivers who call it their home course). **Set as my home course**, and a pinned "Drive" button.
5. **Drive tab**: your home course and recent routes, to start a drive in one tap.
6. **Routes tab**:
   - **My laps**: the routes you've driven, with lap count and PB, linking to run history.
   - **Routes I built** (creators and up): your routes with a "Make public" toggle. A creator with a public route who makes another public gets a dialog to replace it, which also warns that the start and end become visible to everyone. Admins see "N of 5 public".
   - Drivers see **Build routes** with a **Request creator access** button (or "Request pending").
7. **Route builder** (*creators and up*; the server refuses saves from anyone else): tap waypoints that snap to roads (Mapbox Directions), drag and undo, a **Loop** toggle, a sector-length slider with a live preview of the boundaries, standing/rolling, name, Save.
8. **Pre-drive**: first **who to race**: your laps (PB at the top) and, on a public route, any posted lap, each with its big-sector strip. Then a folded setup: display mode (Full HUD or Delta only), voice callouts, the **countdown length (3–10 s)** on standing-start routes, and *Simulate* (a desk test that replays a synthetic or recorded drive). A pinned Start with a summary. The first drive asks you to accept the terms (closed roads and tracks only).
9. **Drive screen**: the screen stays awake (and in the Android app, timing carries on with it off). No controls while moving except **hold to stop**.
   - **Standing start**: "Stop at the start line", then a big **Start countdown** button once stopped there, the full-screen countdown and GO. A jump start shows the red banner while the run continues.
   - **Full HUD**: three big sector boxes over the minisector line, the delta and running time.
   - **Delta only** (or turn the phone sideways): a huge `-0.42` / `+1.07` on a full-screen background coloured by the last minisector.
   - Sound and vibration at each big sector; optional voice callouts ("Sector 2, minus zero point four").
   - Losing GPS never ends a run (section 9, *GPS dropouts*).
10. **Run summary**: the lap is saved automatically. Total time (any penalty shown separately), sector times coloured like the HUD, the trace on the map. **Post to leaderboard** (public routes, valid laps; optional caption and car), **Compare**, **Share image** (a picture of the lap for other apps), and **Discard** (deletes it). Partial laps say how far they got.
11. **Run history**: all your laps on a route with sector strips. Post and unpost, delete, and pick two to compare.
12. **Lap detail**: one lap in **Sectors / Graphs / Map** tabs, measured against the lap it raced, with playback. **Compare with my best**, **Compare with…** (any lap on the route) and, for posted laps, **Race against this**.
13. **Lap comparison**: the views in 4.6. You can swap A and B, or change either.
14. **Profile** (`/u/{username}`): photo, @username, and posts / followers / following counts at the top; name, role badge, home course, P1 count and "Driving since"; Follow button on other people's profiles; a 6-month activity heatmap. Tabs:
    - **Posts**: their posted laps as feed cards, newest first.
    - **Routes**: "Best on" (their PB and leaderboard position per route) and the public routes they built.
    - **Laps** (your own profile only): all your laps grouped by route, the newest three per route with sector strips and a Post link.
    Your own profile has Settings and, for admins, Admin in the top bar.
15. **Followers / Following** lists, each entry with its own Follow button.
16. **Notifications**: new followers, laps that beat yours, decisions on your requests, removed posts and moderated routes. A bell with a count on the Feed.
17. **Settings**: profile (photo, display name, avatar colour), the default countdown length, **GPS logs** (the raw GPS of your last 5 drives, kept on the phone, for replay or bug reports), route creation (your role, and requesting creator or admin access), Mapbox usage this month, *Add to home screen*, *Get the Android app*, sign out.
18. **Admin** (*admins only*): **Requests** (creator requests; admin requests for the owner), **Users** (search, grant or revoke roles), **Routes** (unpublish, hide), **Posts** (remove), **Log** (every grant and decision).
19. **Limit screen**: shown when a Mapbox cap is reached, until the period resets.

---

## 6. Leaderboard integrity

- A lap appears on a leaderboard, in feeds, on profiles and in sector records only if it is **posted** and **valid** (no off-route time, every gate crossed in order, acceptable GPS quality, no dropout over 30 s). Jump-start penalties are included in the leaderboard time.
- Unposted laps never affect what other people see. Purple therefore means the fastest **posted** sector.
- **No server-side verification** on the Spark plan: posted laps are trusted as sent. The security rules check they are self-consistent (positive, increasing splits, total = last split, penalty applied, only your own run, only on a public route, the route's post count moving with it).
- A spoofed GPS trace or edited request can't be detected without a server; out of scope for now.

---

## 7. Risks and how to handle them

| Risk | Mitigation |
|---|---|
| **Safety, legal and app store policy.** Timed leaderboards on *public roads* can be read as encouraging street racing. | **Decided: track days and rally events only.** Every user accepts the terms before the first drive. The drive screen has no controls to tap; use a mount and voice cues. |
| GPS accuracy (1 Hz, tunnels, trees) | Interpolation, quality flags, dropouts that keep the run going (laps over 30 s of dropout kept but not valid), BLE GPS later. |
| Battery and heat during long sessions | High-accuracy GPS runs only on the drive screen. A dark UI saves power on OLED screens. |
| No signal at the track | Everything needed for a drive is cached before it starts; Firestore queues writes until the signal returns. |
| Screen locking mid-drive | PWA: a screen wake lock. Android app: background GPS (a foreground service with a "Timing your drive" notification), so the screen can turn off. |
| Privacy (routes that start at home) | Warn when publishing. Never expose other users' raw traces. |
| Losing the Android signing key | Updates and native Google sign-in depend on it. The key is kept outside the repo, with a copy in GitHub secrets. |

---

## 8. Later ideas
- Live "ghost" delta between sectors, interpolated from the reference trace.
- In-person racing: a live gap between two cars (`RACING_PLAN.md`).
- Push notifications (needs a server, or FCM from the Android app).
- Likes and comments on posts.
- Blocking users and private profiles where follows need approval.
- Car profiles (compare times by car class).
- External 10–25 Hz GNSS receivers over BLE (possible in the Android app).
- Video overlay export (time and delta burned into dashcam footage).
- An iOS app (Capacitor supports it; needs a Mac and an Apple developer account).

---

## 9. Decisions made
- **Standing start**: countdown of 3–10 s (user-set), exact even timing with no random hold. The lap is timed from when the car moves off after GO; no reaction time.
- **Jump start**: +5 s penalty, only for confirmed forward movement of more than 10 m before GO (section 4.3.1). The lap is then timed from GO. The run stays valid.
- **Route creation needs permission**: only creators (admin-granted) and up can build and publish routes. The owner role is set in the database; the owner grants admin.
- **Public routes per role**: creator 1, admin 5, owner unlimited. Admin and owner routes show as Official.

- **Lap comparison**: any two laps on the same route, either your own or against other people's posted laps (section 4.6). Any posted lap can be used as a drive reference.
- **Following and social feed**: one-way follows with no approval. The home tab is a feed of posted laps from people you follow, newest first. Explore has the routes map and search.
- **Posting and users**: laps are private until posted. Posting is only possible on public routes. Many posts per route are allowed; the leaderboard takes each driver's best.

- **Platform and backend**: React + TypeScript (Vite) on **Firebase Hosting**, with Firebase **Auth** and **Firestore** (security rules instead of a server). The project is on the free **Spark** plan, so there are no Cloud Functions:
  - Posted laps are trusted as sent; the security rules still check that they are self-consistent (section 6).
  - Leaderboards, sector records and the feed are computed when read, from posts.
- **Two ways to install**:
  - **PWA** (all phones; the only option on iPhone). Browsers can't keep GPS running with the screen locked, so the drive screen holds a screen wake lock.
  - **Android app**: Capacitor wraps the same web build. Differences are behind `Capacitor.isNativePlatform()`: native Google sign-in (Google blocks its web sign-in inside apps), background GPS with a notification so timing works with the screen off, Android's share sheet, and no service worker. GitHub Actions builds a signed APK on every push that changes the app and publishes it as the latest GitHub release; the PWA's *Get the Android app* button links to it. App updates need a new download; the web version updates on deploy.
- **Maps**: Mapbox GL JS for maps, Mapbox Directions for snapping routes to roads. Route shapes in lists are drawn as SVG from the geometry; a few cards also use Mapbox static images, loaded only when scrolled into view.
- **Mapbox usage cap**: the app counts every map load, Directions request and static map in Firestore (`usage/{period}`) and stops at **45,000 map loads**, **90,000 Directions requests** and **45,000 static maps** per period, just under Mapbox's free tiers. Once a cap is reached the app shows a "monthly limit reached, back on [date]" screen until the period resets.
  - The period resets on the **1st of each month, 00:00 UTC** (`USAGE_RESET_DAY`).
  - The security rules only allow the counters to go up by one at a time and refuse increments past the cap. The cap is still enforced by the app, so the Mapbox token should also be **URL-restricted** in the Mapbox dashboard (it isn't yet; the Android app loads from `https://localhost`, so that origin must be allowed too).

- **Positioning**: the app is for **track days and rally events only** (closed courses). The terms and copy say so; public-road timing is not a use case.
- **Gate accuracy (measured on simulated driving)**: `simulateTrackDrive` models corner-limited speed, braking and a 2.5 m drifting GPS error. Gate error is about 70 ms RMS and under 150 ms p95 on a rally stage and a circuit, and **5 Hz is no better than 1 Hz**. GPS position error dominates, not interpolation (with perfect GPS the error is under 60 ms), so Hermite interpolation is not worth building. Only better fixes help (external 10–25 Hz GNSS). `test/accuracy.test.ts` guards both numbers; real-drive logs dropped into `test/fixtures/` will confirm them.

- **GPS dropouts**: losing the signal **never ends a run**; only the driver does. Gates crossed during a dropout are interpolated across it. A lap with dropouts up to **30 s** (tunnels and forest on rally stages) stays valid; a longer one still finishes and is saved, but is **not valid**, so it can't be posted or set a best. Fixes too vague to place the car (accuracy worse than the 30 m off-route limit) don't count towards leaving the route.
- **Partial laps**: when the driver stops mid-lap after the signal dropped out, the app offers to keep the lap as far as it got. Partial laps are never valid; they can be viewed and compared with other laps up to where they stop.

- **Sector colours**: on **public routes** purple = faster than the route record (fastest posted sector) and your own best (with nothing posted yet it means a new PB), green = faster than your own personal best for that sector. On **private routes** purple = faster than your personal best (your theoretical-best sector), green = faster than the same sector of the lap you're racing. Yellow otherwise. The delta always compares with the lap you race. PBs and records improve during a session, and saved laps show the colours they had when driven.

## 10. Open questions (need decisions)

1. **Changing your public route**: when you swap to a different route, should the old leaderboard be archived (still viewable) or hidden? (Today it is hidden while the route is private.)
2. **Can others save a public route** to their own list, or only drive it?
3. **Leaderboard and posting**: should the leaderboard keep showing only **posted** laps (today), or include every valid lap on a public route automatically?
4. **Your own posts in the feed**: should your own posted laps also appear in your feed? (Today: only followed users'.)
5. **iPhone**: stay with the PWA (screen must stay on while driving), or build the iOS app too?
