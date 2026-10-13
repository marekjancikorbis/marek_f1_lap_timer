---
version: 1
slug: "src"
primary_target: "src"
related_targets: []
---

# Surface: Purple Sector app (all screens)

Mode: operate. Mobile-first PWA, portrait phone first; desktop is a centred column.

## Direction contract

THESIS: The app signals like a marshal post: one colour field tells you everything, readable from a moving car. It refuses the white sports-tracker feed and the broadcast timing-tower clone.

OWN-WORLD: Tarmac greys (#16181A ground, #202326 raised, #2E3236 hairlines), chalk-white ink, flag fields as the only saturation: purple #8B3FE0, green #1FA64F, yellow #F5CF19, red #D9262E for jump start and errors only, blue for info. Barlow Condensed for every time and number (tabular), Barlow for UI text. No kerb stripes (user removed them). Large rounded-rectangle cards, standard web controls.

STORY: A driver opens the feed, sees friends' laps as big times over the shape of the circuit painted in sector colours, taps Race against, drives with a full-screen flag-coloured delta, then posts the lap.

FIRST VIEWPORT: Top bar (wordmark left, avatar right). Feed of large cards: avatar + username + time ago; route name; mini circuit map (SVG of the route, each sector stroked in that lap's sector colour, start/finish marked); huge tabular lap time with P-position and New PB badges; sector colour strip; caption and car; Compare / Race against buttons. Translucent bottom tab bar: Feed, Map, Search, Routes, Profile.

FORM: Marshal Post, candidate 7 of 7; seed: 102c08d5. Signature move: the route shape painted in sector flag colours (feed cards, lap detail, run summary) and the drive screen's full-bleed flag-colour delta field. Raises kept: one registered distance axis for comparison graphs; the delta line owns the comparison screen; strict tabular numerals; map pins sized by posted laps.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
