# Purple Sector design: Livery

The app is painted like a race car. Mockups of every screen: `design/livery/index.html` (open it in a browser; it is assembled from `design/livery/parts/*.html` with `cat parts/*.html > index.html`). The previous blue-black design is git tag `design-blue-v1`.

## Rules

- **Two sides of the car.** Paddock screens (feed, routes, profiles, review) sit on the light body. Everything from Start to the end of a drive is navy with off-white numerals.
- **Every lap wears its stripe.** A lap's three sector results are three slanted bands (purple / green / yellow by the PLAN.md section 9 rules). Large bands carry S1/S2/S3 or the gap; a sector without a time is an empty outline.
- **The brand stripe** (purple, green, yellow, slanted, always in that order) appears only on navy panels, never under data.
- **Action colour.** Navy is what you press on the light body; off-white is what you press on navy.
- **Never pure white `#fff` or pure black `#000`**, including shadows, scrims and SVG fills.
- **Drivers are roundels:** initials in the avatar colour inside an off-white ring, or the photo.
- Stage (point-to-point) routes have no sessions: one run, one summary. Sessions of laps exist only on lap routes.

## Tokens

| Token | Value | Use |
|---|---|---|
| body | `#ECF0F5` | paddock ground |
| card | `#F7F9FC` | cards, sheets, text on navy |
| navy | `#0E1B3D` | panels, drive screens, primary action, ink |
| navy-2 / navy-3 | `#1A2A55` / `#2A3B6B` | raised areas and outlines on navy |
| ink-2 / mute | `#33405F` / `#5B6680` | secondary text |
| rule / rule-2 | `#DFE3EA` / `#C9D0DC` | hairlines, outlines |
| purple | `#8B3FE0` (ink `#6F2BC4`, on navy `#B98AF7`) | fastest ever / route record |
| green | `#1FA64F` (ink `#137A3A`, on navy `#4FE08A`) | faster |
| yellow | `#F5CF19` (ink `#6E5600`) | slower; navy text on it |
| red | `#D9262E` (ink `#B4141C`) | jump start, delete |

Type: Saira (variable width). Times in condensed italic 800 with tabular figures; interface text at normal width; section titles in italic caps; labels in 12px expanded caps.
Shapes: pill buttons 48px tall, 12–18px card radii, sector bands skewed −18°.
