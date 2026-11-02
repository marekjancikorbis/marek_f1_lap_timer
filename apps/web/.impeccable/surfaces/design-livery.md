---
version: 1
slug: "design-livery"
primary_target: "design/livery"
related_targets: []
---

# Surface: Livery redesign concept (all screens, design-only mockups)

Mode: operate. Mobile-first PWA + Android; phone portrait first, the delta-only drive screen landscape. Design pages only: nothing here changes the shipped app in `src/`.

Audience and job: drivers timing themselves on tracks and closed roads; glance-only in the car, review/compare/post in the paddock. Constraints: PRODUCT.md sector colour semantics, no fabricated real users (all mock data labelled sample), English UI.

## Direction contract

THESIS: The app is painted like a race car, distilled: each screen shows one number that matters and one action; every lap wears its three sector results as a slanted stripe instead of words. Detail lives one tap down. It refuses the dark "F1 telemetry" dashboard and the white fitness-tracker feed.

OWN-WORLD: Paddock screens on ground #EEF1F5 as flat rows, no cards; paper #F8F9FB for sheets, inputs and text on navy. Never pure white or pure black (user rule); navy panels #0E1B3D carry headers, the tab bar's Drive button and the whole drive HUD. Brand tri-stripe purple #8B3FE0 / green #1FA64F / yellow #F5CF19, skewed -18deg, always in that order; red #D9262E only for jump start and danger. Navy fills are the action colour on white, white fills on navy. Saira variable: times in condensed italic 800 tabular, UI in normal width, labels in semi-expanded caps. Drivers appear as roundels (initials in their avatar colour inside a white ring).

STORY: Feed (home course name, best time and Drive in the navy panel; followed laps as name, time, stripe) → Drive tab → pre-drive (race against, setup, pinned Start) → arm and lights → HUD (three giant slanted sector bands) → summary → post → lap detail against the raced lap.

FIRST VIEWPORT: Feed: navy panel with the tri-stripe at its right edge, wordmark and bell, home course name, best time at 72px, one Drive button; below, flat rows of roundel, driver and route, time and stripe. Icon-only tab bar on paper with a raised navy GO.

FORM: Livery (race-car paint scheme and number roundels), Impeccable's pick, position 1 on the grounded list; seed: none (unavailable). Signature move: the lap stripe, three skewed bands coloured by sector result with S1/S2/S3 and delta labels, from the feed card up to the full-screen HUD.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
