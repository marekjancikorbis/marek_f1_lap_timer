---
version: 1
slug: "src"
primary_target: "src"
related_targets: []
---

# Surface: Purple Sector app (all screens)

Mode: operate. Mobile-first PWA + Android; phone portrait first, the delta-only drive screen landscape. The shipped app follows this contract; mockups of every screen are in `design/livery/index.html`, rules and tokens in `DESIGN.md`.

Audience and job: drivers timing themselves on tracks and closed roads; glance-only in the car, review/compare/post in the paddock. Constraints: PRODUCT.md sector colour semantics, never pure white or black, English UI, no fabricated users or stats.

## Direction contract

THESIS: The app is painted like a race car: every lap wears its own livery, its three sector results as a slanted stripe. It refuses the dark "F1 telemetry" dashboard and the white fitness-tracker feed.

OWN-WORLD: Paddock screens on paint-white body #F4F6F9 with white cards; navy panels #0E1B3D carry headers, the tab bar's Drive button and the whole drive HUD. Brand tri-stripe purple #8B3FE0 / green #1FA64F / yellow #F5CF19, skewed -18deg, always in that order; red #D9262E only for jump start and danger. Navy fills are the action colour on white, white fills on navy. Saira variable: times in condensed italic 800 tabular, UI in normal width, labels in semi-expanded caps. Drivers appear as roundels (initials in their avatar colour inside a white ring).

STORY: Feed (home course in the navy panel, laps each wearing their stripe, one "Race" action) → Drive tab → pre-drive (race against, setup, pinned Start) → arm and lights → HUD (three giant slanted sector bands) → summary → post → lap detail against the raced lap.

FIRST VIEWPORT: Feed: navy panel with the tri-stripe cut across its right edge, wordmark left and roundel right, home course name, best time at 56px, Drive and Times buttons; below on white, "Following" list of lap cards: roundel, driver and route, time, the lap's own sector stripe, a Race button. Tab bar white with a raised navy Drive roundel.

FORM: Livery (race-car paint scheme and number roundels), Impeccable's pick, position 1 on the grounded list; seed: none (unavailable). Signature move: the lap stripe, three skewed bands coloured by sector result with S1/S2/S3 and delta labels, from the feed card up to the full-screen HUD.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
