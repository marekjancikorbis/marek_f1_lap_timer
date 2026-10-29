# Lap Timer: Project Plan

A mobile app for timing drives on routes you define yourself, racing against your
own earlier times, and competing with other drivers on routes they publish.

**Only approved users can create routes.** An admin grants that permission from an admin account. Everyone else can still drive public routes and appear on their leaderboards.

---

## 1. Feature summary

| Area | What it does |
|---|---|
| **Roles and permissions** | Three roles. A **driver** (every new account) can drive public routes, race their own times and appear on leaderboards. A **creator** can also create routes; an admin grants this. An **admin** grants and revokes creator access and can moderate public routes. |
| **Route builder** | *Creators only.* Draw a route on a map, snapped to roads. It can be point-to-point or a **lap** (loop, where start = finish). Choose a **sector length** (50–1000 m) and a **standing** or **rolling** start. |
| **My routes** | Each creator's routes are private. Only the owner can see them, except for the one public route described below. Drivers see the public routes they have driven. |
| **Drive** | Pick a route and a previous run to race against (the reference), then drive. Times are taken from GPS crossings of the start, sector and finish gates. |
| **Drive screens** | **Full HUD**: running time, delta, sector times, etc. **Delta-only**: the delta fills the screen, and the background colour shows how the last sector went (yellow/green/purple). |
| **Delta logic** | The delta updates only when you **cross the end of a sector**: your elapsed time at that sector boundary minus the reference run's elapsed time at the same boundary. |
| **Social feed (home)** | Shows the **posted laps of everyone you follow**, newest at the top. Each card has the lap time, route, sectors and caption, plus quick **Compare** and **Race against** buttons. |
| **Following** | Follow and unfollow anyone from their user page. Follower and following counts and lists are on every profile. |
| **Routes map** | Each creator can make **one** route public, and it gets a leaderboard. The **Map** tab shows every public route, and tapping one opens its leaderboard. |
| **Posting laps** | Laps are private by default. On a public route you can **post** a lap, which puts it on the route's leaderboard and on your user page. You can remove a post at any time. |
| **Lap comparison** | Put any two laps side by side on the same route: your own laps, your lap against **another person's posted lap**, or against your theoretical best or the route record. It shows sector times, a delta graph, a speed graph and a map coloured by who was faster. |
| **Users** | **User search** by username. **User pages** show a person's posted laps (with a PB per route), their public route and stats. From any posted lap you can **compare** with it or **race against it**. |

---

## 2. Tech stack

Installable web app (PWA): React + TypeScript (Vite), Firebase Auth + Firestore (Spark plan),
Firebase Hosting, Mapbox GL JS. See *Platform and backend* in section 9 and `apps/web/PRODUCT.md`.

```
apps/web/          the app (screens, map, drive HUD)
packages/timing/   pure TS timing engine + unit tests + GPS fixtures
firestore.rules    security rules (tests in tests/)
```

---

## 3. Core concepts and data model

### Route
- `geometry`: an ordered polyline (LineString). **Direction matters**, so it runs from start to finish.
- `is_loop`: if true, the finish gate is the start gate and laps can run back to back.
- `sector_length_m`: 50–1000 m, in steps of 50 m.
- `sector_boundaries_m[]`: the distances along the route where each sector ends. These are **computed once and frozen** when the route is saved. Example: a 2,300 m route with 500 m sectors has boundaries `[500, 1000, 1500, 2000, 2300]`. If the last sector would be shorter than half a sector length, it is merged into the previous one.
- `start_type`: `standing` | `rolling`.
- Once a route has any runs, its geometry and sectors **cannot be edited**, because edits would make old times incomparable. Users can duplicate the route instead.

### Run
- The time at each gate crossing, stored as cumulative times: `split_times_ms[]` (elapsed time at each sector end). Sector times are the differences between consecutive splits.
- `total_ms`, a `valid` flag, GPS quality stats, and the raw GPS trace (kept in Storage and used for verification and replay).
- On loop routes, each lap is its own run, and runs from the same session share a `session_id`.

### Roles and permissions
| Role | How you get it | What it allows |
|---|---|---|
| `driver` | Every new account | Follow people, see the social feed, browse the routes map. Drive **public** routes, see your own runs and appear on leaderboards. |
| `creator` | An **admin grants it** in the admin screen | Everything a driver can do, plus create private routes and publish **one** of them. |
| `admin` | Set once **directly in the database** for your own account; it can't be granted from the app | Grant and revoke `creator`, review access requests, and hide or unpublish any public route. |

- **The server enforces everything**, not just the app UI.
  - The Firestore security rules refuse a route insert from anyone who isn't a creator, even if someone calls the API directly.
  - Hiding the route builder button is only a convenience.
- **Users can never change their own role.** Roles live in a separate `roles` collection that only admins can write to, not in the user's profile, which they can edit.
- **Revoking creator access**:
  - The user can no longer create new routes or publish.
  - Their existing routes and runs stay, so other people's leaderboard times are not lost.
  - The admin can separately unpublish or hide their public route.
- **Requesting access**: a driver can tap "Request creator access" and add an optional note. The admin sees pending requests in the admin screen and approves or rejects each one. Every grant and revoke is logged.
- **More admins**: only the bootstrap admin (you) exists at first. Making someone else an admin is also a database operation, which keeps it deliberate.

Who can read and write what is enforced by `firestore.rules` (tests: `npm run test:rules`).
Raw GPS traces stay private to their owner; others see only posted laps.

---

## 4. Timing engine (`packages/timing`)

The engine is a pure function with no UI. It takes a stream of GPS fixes `{lat, lon, t, accuracy, speed, heading}` and emits events: `armed`, `started`, `sectorComplete(k, splitMs, sectorMs, deltaMs, colour)`, `finished`, `lapComplete`, `invalidated(reason)`.

### 4.1 Where am I on the route?
1. Before the drive, resample the route polyline every ~2 m and record the cumulative distance at each point.
2. Project each GPS fix onto the polyline to get **`s`** (distance along the route) and **`e`** (lateral offset from the line).
3. Only search a **window** around the last known `s` (from slightly behind to a little ahead, scaled by speed). This handles routes that cross themselves and loops where start and finish are the same point.
4. If `e` stays above ~30 m for more than a few seconds, you are off route and the run is invalidated. Fixes with poor accuracy (more than ~20 m) are flagged and lower the run's quality score.

### 4.2 Precise gate crossings
Phone GPS usually updates at **about 1 Hz**, which at 100 km/h means a fix only every ~28 m. Taking the timestamp of the fix after the line would therefore be off by up to a second. Instead, the engine interpolates:

```
if s_prev < boundary <= s_curr:
    t_cross = t_prev + (boundary - s_prev) / (s_curr - s_prev) * (t_curr - t_prev)
```

- Use **GPS fix timestamps**, not the time JavaScript received the fix.
- Later, Hermite interpolation using the speed at both fixes can improve accuracy when the car is accelerating or braking.
- Expected accuracy with a phone is about ±0.1–0.2 s. An external 10–25 Hz Bluetooth GPS (RaceBox, Dragy, etc.) would be a later upgrade (section 8).

### 4.3 Starts
- **Rolling**: the timer arms when you are within ~50 m of the start and heading in the route's direction. It starts when you cross the start gate, which is a line perpendicular to the route at its first point, using the same interpolation.
- **Standing (countdown start)**:
  1. You stop within ~15 m of the start. The engine confirms you are stationary (speed < 1 km/h for 2 s), then enables the **Start countdown** button. This is the only tap during a run, and it happens while the car is stopped.
  2. A **countdown of 3–10 s** runs. You set its length on the pre-drive screen; the default is 5 s.
     - The timing is **exact and even**: one beat per second with no random hold, so GO always comes exactly N seconds after the tap.
     - It shows as large numbers plus an F1-style row of lights, with a beep each second and a different tone on GO.
     - The countdown runs on a monotonic clock. The GO instant is matched to the GPS time base, so the timer start lines up with the fix timestamps used for the gates.
  3. **The timer starts at GO**, not when the car moves, so your reaction time is part of the lap time. That is fair across all drivers, and the countdown length you choose doesn't affect the time.
  4. **Jump start: a +5 s penalty**, applied only when the car has really moved **more than 10 m forward before GO** (see 4.3.1). Smaller movements are ignored.
     - The run keeps going. The HUD shows a **"JUMP START +5.0 s"** banner for a few seconds.
     - The penalty is added to sector 1, so every split, delta, colour and the final time include it. A jump can never earn a purple sector or a better delta.
     - Penalised runs are still **valid**. They count on the leaderboard with the penalty included and can be used as a reference.
     - The countdown can also be cancelled before GO with no penalty.
  5. **Reaction time** is the time from GO to first motion (accelerometer). It is saved with the run and shown in the summary. After a jump start it is shown as negative, e.g. "−0.4 s".

#### 4.3.1 Jump-start detection without false penalties
GPS **position** is the unreliable part. A phone sitting still often shows its position wandering 3–10 m (or more near buildings and trees). Comparing raw positions against a 10 m threshold would therefore produce false penalties. Instead, the engine estimates the distance moved before GO **from signals that don't drift**:

1. **Anchor**: during the ≥2 s stationary check and the countdown, average the GPS fixes to get one stable start position. The accelerometer baseline (gravity and phone mount angle) is captured at the same time.
2. **Is the car really moving?** Motion counts only when **both** of these agree:
   - **Accelerometer**: sustained forward acceleration above ~0.1 g for more than 300 ms, after a low-pass filter. Engine revs, door slams and phone taps are short spikes and get filtered out.
   - **GPS Doppler speed** (the fix's `speed` field) above ~1.5 m/s. Speed comes from the Doppler shift of the satellite signals, not from position differences, so it stays near zero while the car is stationary even when the reported position is wandering.
3. **How far before GO?** Once motion is confirmed, the distance travelled up to GO is the **integral of Doppler speed over time**. Accelerometer data fills the gaps between 1 Hz fixes. Only movement **forward along the route** counts, so rolling back on a hill is never penalised.
4. **Decision**: a penalty applies only if the integrated distance is **> 10 m**.
   - **Cross-check**: if the GPS reports poor accuracy (> 15 m) during the countdown, motion must also be confirmed by the projected route position `s` being clearly ahead of the anchor once the fixes settle. If the signals still disagree, **no penalty is given**, because the driver gets the benefit of the doubt.
5. **Server re-check**: the trace upload includes a short accelerometer log covering 10 s before GO to 5 s after it. `verify-run` repeats the same decision, so the phone and the server agree on penalties for leaderboard runs.

The 10 m threshold is a setting in the engine (`JUMP_START_THRESHOLD_M`). Because the method doesn't rely on raw positions, it could be lowered later, e.g. to 3–5 m, without causing false penalties. Under the threshold, creeping a few metres gives a tiny head start, which is accepted as the cost of never penalising GPS noise.

### 4.4 Delta and colours (at each sector end k)
```
split_k   = t_cross_k - t_start                    // elapsed at sector end
sector_k  = split_k - split_(k-1)
delta_k   = split_k - ref.split_times_ms[k]         // negative = ahead
colour_k  = purple  if sector_k < route_sector_records[k]   (fastest ever, any user)
            green   if sector_k < ref sector_k
            yellow  otherwise
```
> **Superseded** by *Sector colours* in section 9, which is what the code does.

- Purple overrides green.
- The sector records are **downloaded before the drive**, so colours work offline.
- On a **private** route the only driver is you, so purple means your own all-time best for that sector.

### 4.5 Laps
On loop routes, crossing the finish gate completes the lap and immediately starts the next one at the same instant. Each lap is compared against the selected reference lap.

### 4.6 Comparing laps (after the drive)
Two laps can be compared only on the **same route**, so they share the same frozen sector boundaries. The comparison code lives in `packages/timing` (`compareLaps(a, b)`), so the app and the server use the same logic.

**What lap B can be:**
- Another one of **your own laps**.
- **Someone else's posted lap**: picked from the leaderboard, their user page or the route's posts.
- **Your theoretical best**: the sum of your best time in each sector.
- **The route record**: the sum of the purple sectors.

**What the comparison shows:**

| View | Data used |
|---|---|
| **Header** | Both total times, the gap, and penalties and reaction times shown separately. |
| **Sector table** | A and B sector times side by side with the difference. The faster one is highlighted, and purple marks a route record. |
| **Delta graph** | Cumulative gap (A − B) against **distance along the route**. With `lap_profiles`, the line is smooth (one point every 10 m), so it shows exactly *where* time is gained or lost. Without them, it is drawn from the sector splits only. |
| **Speed graph** | Both speed traces against distance, overlaid, to show braking points, corner speed and exit speed. Needs `lap_profiles`. |
| **Map** | The route coloured per sector by who was faster, with a slider that moves both "ghost" cars along the route. |

- `lap_profiles` exist for every **verified** run, whether yours or posted. Your own unverified runs on private routes have them too, computed **on the device** from your local trace.
- Raw GPS traces of other users are never needed: comparisons use only distance-indexed time and speed.

**Racing against someone else's lap:** any posted lap on a route can be chosen as the **reference for a drive**. The live delta during the drive then compares you against that person's splits.

### 4.7 Social feed
- **Content**: every visible post (verified, on a public route that isn't hidden) by users **you follow**, newest first.
- **Query**: the feed is built **when it is read**: posts where `userId` is in your follows, newest first, 20 at a time (Firestore `in` takes at most 30 ids, so follows are queried in chunks of 30: `feedPage` in `lib/data.ts`).
- **Freshness**: pull to refresh. While the app is open, a Firestore listener watches for new posts from people you follow and shows a **"3 new laps ↑"** pill. Tapping it loads them at the top without jumping the scroll position.
- **Consistency**:
  - Unfollowing someone removes their posts from your feed immediately, because the feed is computed on read.
  - Deleted, unposted and moderated posts disappear the same way.
  - A post shows up once its lap is verified, ordered by its **post time**.
- **Scaling later**: if the number of follows grows very large, switch to writing each post into followers' feeds at post time, using a `feed_items` table filled by a trigger. Not needed for v1.

---

## 5. Screens

1. **Auth**: sign up or log in (email, Apple, Google), then choose a username. New accounts are **drivers**.
2. **Social feed (home)**: posted laps from people you follow, newest at the top, with infinite scroll and pull to refresh (see 4.7). Each card shows:
   - avatar, username, and how long ago it was posted (tap to open their user page),
   - route name with a small map thumbnail (tap to open the route leaderboard),
   - a **big lap time**, a penalty badge if any, the leaderboard position when posted (e.g. **P3**) and a **New PB** badge when it beat their previous best,
   - a strip of sector colours (purple for route records),
   - caption and car,
   - buttons: **Compare with my best** (only if you've driven that route), **Race against** and **Details** (opens Lap detail).

   **Empty state** (not following anyone yet): a "Find drivers" button that opens search, plus suggested drivers such as leaders on public routes near you, with one-tap Follow buttons.
3. **Routes map**: a full-screen map.
   - Zoomed out, public routes show as clustered start pins. Zoomed in, they show as coloured polylines.
   - Data loads by viewport through a PostGIS bounding-box query, using simplified geometry.
   - Tapping a route opens **Route detail**.
4. **Route detail / leaderboard**: the route on a map, its length, sector count, start type and owner. Below that, a ranked list of each user's best **posted** lap, with the purple sector records. There is a "Drive this route" button.
   - Tapping a username opens their **user page**.
   - Each row has **Compare with my best** and **Race against** buttons.
5. **My routes**:
   - **Creators** see a list of their routes with thumbnails and personal bests. Each route has a "Make public" toggle.
     - If you already have a public route, turning on "Make public" for another one opens a dialog asking whether to replace it.
     - The dialog also warns that the start and end points become visible to everyone.
   - **Drivers** see the public routes they have driven and a **"Request creator access"** button (or "Request pending" once sent).
6. **Route builder** (*creators only*; the server refuses saves from anyone else):
   - Tap waypoints on the map; they snap to roads through the Directions API.
   - You can drag waypoints and undo.
   - A **Loop** toggle closes the route.
   - A sector slider (50–1000 m) shows a live preview of the sector boundaries as tick marks on the route.
   - Standing/rolling toggle, a name field, and Save.
7. **Pre-drive setup**: choose the route, then the reference lap. The list shows date, total time and sector times, with your PB at the top. On a public route you can also pick **any posted lap from another user**, such as the leader, a friend, or anyone found through search. You also choose the screen mode (Full HUD or Delta-only). On standing-start routes you set the **countdown length (3–10 s)**, which is remembered per user.
8. **Drive screen**: the screen stays awake and there are no controls to tap while moving (large Stop button only).
   - **Standing start**: while you wait at the start line, a big **Start countdown** button appears once you are stopped there. It is followed by the full-screen countdown (numbers, lights and beeps) and GO. A jump start shows a red **JUMP START +5.0 s** banner for a few seconds while the run continues.
   - **Full HUD**: running time, current delta (updated at each sector end), last sector time and its delta, sector k/N, distance to the next gate, and speed.
   - **Delta-only**: a huge `-0.42` / `+1.07`, with the full-screen background coloured yellow, green or purple by the last sector.
   - Both modes give haptic and sound cues at each gate. Optional voice callouts ("Sector 3, minus zero point four") let the driver keep their eyes on the road.
9. **Run summary**: total time (with any penalty shown separately, e.g. `1:42.310 (incl. +5.000 jump start)`), reaction time (standing starts), a table of sector times coloured like the HUD, the trace on the map coloured by sector, and Save or Discard.
   - **Compare** opens the comparison against the reference lap you just raced.
   - **Post** appears on public routes for valid laps. It takes an optional caption and car, and the post goes live once the server verifies the lap.
10. **Run history**: all runs per route, with the option to delete runs.
   - Select any two laps to **compare** them.
   - Each lap shows a "Posted" badge, with Post and Unpost actions.
11. **Admin panel** (*admins only*; hidden for everyone else):
    - **Requests**: pending creator requests with the user's name and note, and Approve or Reject.
    - **Users**: search by username, see each user's role, and **grant or revoke creator** with one toggle.
    - **Public routes**: every published route, with Unpublish and Hide actions for moderation.
    - **Log**: who granted or revoked what, and when.
    - **Posts**: remove a post (moderation).
12. **User search**: a search box with results as you type (username, partial match), showing avatar, username, a creator badge, the number of posted laps and a **Follow** button.
13. **User page**:
    - **Header**: avatar, username, a creator badge, member since, and stats (posted laps, routes driven, current #1 positions).
    - **Follow / Following** button. **Followers** and **Following** counts; tapping them opens the lists, where each entry has its own Follow button.
    - **Their public route**: shown if they have one, with a link to its leaderboard.
    - **Posted laps**: grouped by route, with the PB per route at the top. Each entry shows time, date, leaderboard position, caption and car.
    - Tapping a lap opens **Lap detail**.
    - Your own page also has **Edit profile** (avatar, username) and lets you remove posts.
14. **Lap detail**: one lap's sector table, delta and speed graph and map. It has **Compare with my best**, **Compare with…** (choose any lap on the route) and **Race against this**, which opens pre-drive with this lap as the reference.
15. **Lap comparison**: the views described in 4.6. You can swap A and B, or change B to another lap.

**Navigation (bottom tabs):** Feed (home) · Map · Search · My routes · Profile. Admins also get an Admin tab.

---

## 6. Leaderboard integrity

> On the Spark plan there is no server, so `verify-run` doesn't exist: see *Platform and backend* in section 9.

- A lap appears on the leaderboard, on user pages and in sector records only if it is **posted**, `valid` (no off-route time, every gate crossed in order, acceptable GPS quality) **and** `verified`. Jump-start penalties are included in the leaderboard time.
- Unposted laps never affect what other people see. Purple therefore means the fastest **posted** sector.
- **Verification**: an Edge Function `verify-run` downloads the uploaded trace and replays it through the **same `packages/timing` engine**. If the times it computes match the times the phone reported (within tolerance), the run is marked `verified`, its `lap_profiles` are computed, and, if the lap is posted, the leaderboard and sector records are updated.
- Plausibility checks: maximum speed and acceleration limits, and a check that the GPS timestamps are monotonic and not too sparse.
- This stops basic cheating, such as faking times in the request. A spoofed GPS trace is much harder to detect, so it is out of scope for v1.

---

## 7. Risks and how to handle them

| Risk | Mitigation |
|---|---|
| **Safety, legal and app store policy.** Timed leaderboards on *public roads* can be read as encouraging street racing. Apple's guideline 1.4.5 rejects apps that urge risky activities, and there is liability exposure. | **Decided: track days and rally events only.** Require accepting the terms before the first drive. Do not reward anything just for being fast on unclosed roads (or label public roads clearly). Keep the drive screen free of controls to tap, and use a mount and voice cues. |
| GPS accuracy (1 Hz, urban canyons, tunnels) | Interpolation, quality scoring, laps with long gaps kept but not valid, and BLE GPS later. |
| Battery and heat during long sessions | High-accuracy GPS runs only while a run is armed. A dark UI saves power on OLED screens. |
| No signal on mountain roads | Offline-first: everything needed for a drive is cached, and uploads are queued. |
| Background location permission (store review) | Request "while using" first. Ask for background access only so the timer keeps running if the screen locks, and explain why. |
| Privacy (routes that start at home) | Warn when publishing. Never expose other users' raw traces. |

---

## 8. Later ideas (not in v1)
- Live "ghost" delta between sectors, interpolated from the reference trace.
- Push notifications: a followed user posts, someone follows you, someone beats your time on a route.
- Likes and comments on posts.
- Blocking users and private profiles where follows need approval.
- Car profiles (compare times by car class).
- External 10–25 Hz GNSS receivers over BLE.
- Video overlay export (time and delta burned into dashcam footage).

---

## 9. Decisions made
- **Standing start**: countdown of 3–10 s (user-set), exact even timing with no random hold; the timer starts at GO.
- **Jump start**: +5 s penalty, only for confirmed forward movement of more than 10 m before GO (section 4.3.1). The run stays valid.
- **Route creation needs permission**: only users the admin approves (role `creator`) can create and publish routes. Everyone else is a driver who drives public routes. The admin role is set in the database, not from the app.

- **Lap comparison**: any two laps on the same route, either your own or against other people's posted laps (section 4.6). Any posted lap can be used as a drive reference.
- **Following and social feed**: one-way follows with no approval. The home tab is a feed of posted laps from people you follow, newest first. The routes map moves to its own tab.
- **Posting and users**: laps are private until posted. Posting is only possible on public routes. There is user search and there are user pages showing posted laps.

- **Platform and backend**: the app ships as an installable **web app (PWA)** built with React + TypeScript (Vite), hosted on **Firebase Hosting**. Firebase **Auth** and **Firestore** replace Supabase, and Firestore security rules replace RLS. The project is on the free **Spark** plan, so there are no Cloud Functions:
  - `verify-run` cannot run on a server. Posted laps are trusted as sent; the security rules still check that they are self-consistent (positive, increasing splits, total = last split, penalty applied, only your own run on a public route).
  - Leaderboards, sector records and the feed are computed when read, from posts.
  - Browsers cannot keep GPS running with the screen locked, so the drive screen holds a screen wake lock instead of using background location.
- **Maps**: Mapbox GL JS for maps, Mapbox Directions for snapping routes to roads. Route thumbnails are drawn as SVG from the route geometry, so they cost no map loads.
- **Mapbox usage cap**: the app counts every map load and every Directions request in Firestore (`usage/{period}`) and stops at **45,000 map loads** and **90,000 Directions requests** per period, just under Mapbox's free tier. Once a cap is reached the app shows a "monthly limit reached, back on [date]" screen and is unusable until the period resets.
  - The period resets on the **1st of each month, 00:00 UTC**. The reset day is one setting (`USAGE_RESET_DAY`), so it can be matched to the Mapbox billing cycle.
  - The security rules only allow the counters to go up by one at a time and refuse increments past the cap. On Spark the cap is still enforced by the app, so the Mapbox token must also be **URL-restricted** to the app's domain in the Mapbox dashboard.

- **Positioning**: the app is for **track days and rally events only** (closed courses). The app store listing, terms and copy say so; public-road timing is not a use case.
- **Gate accuracy (measured on simulated driving)**: `simulateTrackDrive` models corner-limited speed, braking and a 2.5 m drifting GPS error. Gate error is about 70 ms RMS and under 150 ms p95 on a rally stage and a circuit, and **5 Hz is no better than 1 Hz**. GPS position error dominates, not interpolation (with perfect GPS the error is under 60 ms), so Hermite interpolation is not worth building. Only better fixes help (external 10–25 Hz GNSS). `test/accuracy.test.ts` guards both numbers; real-drive logs dropped into `test/fixtures/` will confirm them.

- **GPS dropouts**: losing the signal **never ends a run**; only the driver does. Gates crossed during a dropout are interpolated across it. A lap with dropouts up to **30 s** (tunnels and forest on rally stages) stays valid; a longer one still finishes and is saved, but is **not valid** (nothing is known about the route in between), so it can't be posted or set a best. Fixes too vague to place the car (accuracy worse than the 30 m off-route limit) don't count towards leaving the route.
- **Partial laps**: when the driver stops mid-lap after the signal dropped out, the app offers to keep the lap as far as it got: the gates crossed, the trace and the profile up to the last fix. Partial laps are never valid; they can be viewed and compared with other laps up to where they stop.

- **Sector colours**: on **public routes** purple = faster than the route record (fastest posted sector) and your own best (with nothing posted yet it means a new PB), green = faster than your own personal best for that sector. On **private routes** purple = faster than your personal best (your theoretical-best sector), green = faster than the same sector of the lap you're racing. Yellow otherwise. The delta always compares with the lap you race. PBs and records improve during a session, and saved laps show the colours they had when driven.

## 10. Open questions (need decisions)

1. **Platforms**: iOS and Android both (assumed), or one first?
4. **Laps**: on a loop route, should laps run back to back in one session (assumed), with a fixed lap count or until you stop?
5. **Changing your public route**: when you swap to a different route, should the old leaderboard be archived (still viewable) or hidden?
6. **Can others save a public route** to their own list, or only drive it from the feed?
8. **Map provider**: is Mapbox OK, or do you prefer Google Maps?
9. **Scope of the permission**: should approval be needed to create **any** route (assumed), or only to **publish** one? With the second option, everyone could build private routes and only approved users could make one public.
11. **Leaderboard and posting**: should the leaderboard show only **posted** laps (assumed, so nothing appears publicly without your choice), or automatically include every verified lap on a public route?
12. **Posts per route**: can a user post many laps on one route (assumed: yes, with the leaderboard taking their best), or only one, so a new post replaces the old one?
13. **Your own posts in the feed**: should your own posted laps also appear in your feed, or only followed users' (assumed, per the brief)?
