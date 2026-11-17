# Motion spec: Telemetry design

Applies to the Telemetry port (`design/redesigns/src/telemetry.html`) in `apps/web/src`.
Sources: the `apple-design` skill (WWDC *Designing Fluid Interfaces*), `ui-ux-pro-max` §7 Animation,
§2 Touch, §3 Performance, plus what the app already does. Most of the motion system already exists in
`src/styles/tiles.css` (springs, screen entrance, press states) and `src/lib/pullSheet.ts` (gesture sheets).
This spec keeps that, names it, fills the gaps and lists the fixes. **No new dependency** (see the end).

## 1. Principles

1. **Purpose.** Each motion does one of four jobs: feedback (a press, a hold), continuity (where a screen
   or sheet came from), state change (a sector got timed, a toggle flipped), or status (loading). Anything
   else is decoration and doesn't ship.
2. **Restraint.** One motion per event. Nothing loops except loading indicators. No stagger cascades, no
   number tweening, no confetti. A new PB gets one entrance, not a party.
3. **Interruptible, never blocking.** Input is never locked during motion. Gesture-driven things (sheets)
   use the JS spring in `pullSheet.ts`, which starts from the on-screen position and speed. CSS
   transitions are fine for state changes because they reverse from the current value. Never put
   `pointer-events: none` on anything for the length of an animation.
4. **Spatial consistency.** Drilling in comes from the right and Back comes from the left. Tabs are peers
   and only rise. A sheet leaves the way it came (down). Popovers grow from their trigger
   (`transform-origin` set to the trigger).
5. **Response on press-down.** Feedback starts on `:active`/`pointerdown` in ≤100 ms and settles with a
   spring on release.
6. **Compositor-only.** Animate `transform` and `opacity` only. `background-color`/`box-shadow` are
   allowed for one-shot state changes on small elements. Never animate `width`, `height`, `max-height`,
   `top`, `left`, `filter: blur()` or `backdrop-filter`.
7. **The Drive screen is sacred.** While timing (`.dv`), the driver looks for half a second at a time.
   Motion there must not cost frames (the elapsed clock and GPS work run on the main thread) or pull the
   eye. The rules are in §5.
8. **Reduced motion is a different motion, not none.** Under `prefers-reduced-motion: reduce`, slides,
   scales and springs become ≤160 ms opacity cross-fades or instant changes. Progress that carries
   meaning (hold-to-stop fill, countdown lights) stays.

## 2. Tokens

Put these in `:root` in `src/styles/tiles.css`, next to the existing `--spring` / `--spring-bounce`, which
stay exactly as they are (critically damped / damping 0.78 springs sampled into `linear()`).

```css
:root {
  /* curves */
  /* --spring, --spring-bounce: existing linear() springs; settle about .5s at full duration */
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);   /* existing in global.css: entrances, state changes */
  --ease-in: cubic-bezier(0.55, 0, 1, 0.45);    /* exits only: leaves quickly, no lingering */
  --ease-press: ease-out;                       /* the 100 ms press-down */
  /* durations */
  --d-press: 100ms;    /* touch-down scale */
  --d-fast: 160ms;     /* colour/opacity state changes, reduced-motion fades */
  --d-state: 240ms;    /* toggles, selected tiles, sector tint, toast exit */
  --d-exit: 260ms;     /* sheet/modal leaving (about 60% of the entrance) */
  --d-screen: 450ms;   /* screen entrance, press release (spring settle) */
  --d-sheet: 500ms;    /* modal sheet entrance */
  --d-hold: 800ms;     /* hold-to-stop; must equal the timeout in HoldToStop */
  /* distances */
  --m-rise: 10px;      /* tab screens rising in */
  --m-slide: 24px;     /* drill-in / back */
  --m-press: 0.96;     /* buttons, icon buttons: .94 */
}
/* Android WebViews older than Chrome 113 drop a whole declaration whose linear() they can't parse */
@supports not (transition-timing-function: linear(0, 1)) {
  :root { --spring: cubic-bezier(0.22, 1, 0.36, 1); --spring-bounce: cubic-bezier(0.34, 1.25, 0.64, 1); }
}
```

JS spring (`pullSheet.ts spring()`): response 0.38 s, damping 0.85, with velocity handoff and Apple's
`project()` with a deceleration rate of 0.998. Keep these values. They are the only JS-driven animation
values.

When to use which curve:
- `--spring` (no overshoot): screen entrances, press release, tapped-open sheets. The default.
- `--spring-bounce`: only when the user's motion had momentum (a flicked sheet, which the JS spring
  already handles) or a highlight sliding to a new choice (segmented control thumb).
- `--ease-out`: one-shot state changes (colour, opacity).
- `--ease-in`: exits.
- `linear`: progress that maps to time (hold fill, ambient orbit, spinner).

## 3. Interaction table

| # | Element / interaction | What animates | Property | Duration / easing | Reduced motion |
|---|---|---|---|---|---|
| **Navigation** |||||
| 1 | Drill into a detail screen (feed → lap, route, run, user) | screen children slide in from the right | `opacity 0→1`, `translateX(24px→0)` | `--d-screen` `--spring` (existing `ph-fwd`) | `ph-fade` 160 ms |
| 2 | Back (POP to a lower entry) | same, from the left | `translateX(-24px→0)` | same (`ph-back`) | `ph-fade` |
| 3 | Tab switch (Home / Explore / Drive / Times / Profile) | the new tab's content rises | `opacity`, `translateY(10px→0)` | `--d-screen` `--spring` (`ph-in`) | `ph-fade` |
| 4 | The screen being left | nothing: unmounts at once. No exit animation, so input is never blocked | n/a | n/a | n/a |
| 5 | Explore (kept-alive map) shown/hidden | nothing: map layer swaps instantly; only its sheet/search chrome gets `ph-in` | n/a | n/a | n/a |
| 6 | Enter Drive (`/drive/:id/go`) | HUD fades in, no slide (a mode change, not a drill-in) | `opacity` | 200 ms `--ease-out` | same |
| 7 | Leave Drive → result | result sheet rises (row 15). The map is already there | see 15 | | |
| 8 | Theme change | whole page cross-fades via View Transitions (existing `lib/theme.ts`) | VT root snapshot | 420 ms `--ease-out` | instant (already skipped) |
| **Tab bar (`.dock`)** |||||
| 9 | Press a tab | icon scales | `transform: scale(.9)` | `--d-press` in, `.45s --spring` out (existing) | no scale |
| 10 | Active tab changes | `.on` pill background and ink colour | `background-color`, `color` | `--d-state` `--ease-out` | `--d-fast` |
| 11 | Drive (raised red) tab press | scale `.94` | `transform` | as 9 | no scale |
| **Press feedback** |||||
| 12 | `button.glass`, `.btn`, `.solid`, `.glass.lift` cards, `.tl` tiles | shrink on touch-down, spring back | `transform: scale(.96)`; cards `.98`; `.ib` `.94` | `--d-press --ease-press` down, `--d-screen --spring` up | no scale; keep `:active` background tint |
| 13 | List rows (`.rows > a`) | press tint | `background-color` | 0 ms in, 200 ms out (existing) | same |
| 14 | Glass `--lit` sheen (`.glass.pressed`) | specular highlight at touch point | `--lit` registered prop | 120 ms in / 600 ms out (existing) | keep (opacity-like, non-vestibular) |
| **Sheets, overlays** |||||
| 15 | Modal sheet open (`Sheet` in `components/ui.tsx`: PostSheet, menus) | sheet rises from below; scrim fades | `translateY(105%→0)`; scrim `opacity` | `--d-sheet` **`--spring`** (change from `--spring-bounce`: a tap carries no momentum); scrim 200 ms | sheet `ph-fade` 160 ms, scrim same |
| 16 | Modal sheet close (button, scrim tap, Esc) | sheet drops, scrim fades | `translateY(0→105%)`, `opacity` | `--d-exit --ease-in` | 160 ms fade |
| 17 | Modal sheet drag-to-dismiss | 1:1 with finger; on release: project, then JS spring with release velocity | `transform` (inline) | `spring()` (0.38 / 0.85) | snaps (`still()` already) |
| 18 | Pull sheets (Explore results, Route detail, Builder) | same as 17, existing `usePullSheet` | `transform` | `spring()`; rubber-band past ends | snaps |
| 19 | Toast in | rises and fades | `translateY(16px→0)`, `opacity` | 320 ms `--spring` | 160 ms fade |
| 20 | Toast out | fades | `opacity` | `--d-state --ease-in` | same |
| 21 | Popover / menu from a button | grows from trigger | `scale(.96→1)`, `opacity`, `transform-origin` = trigger | 200 ms `--ease-out`; out 140 ms `--ease-in` | fade |
| **Controls** |||||
| 22 | Range slider (sector length) | **thumb and fill track 1:1, no transition**; `<output>` text updates every input | none | n/a | n/a |
| 23 | Stepper − / + (Lights 5 s) | press scale only; value text changes instantly | `transform` | as 12 | none |
| 24 | Toggle buttons (voice `aria-pressed`, Follow) | background and ink colour | `background-color`, `color` | `--d-state --ease-out` | `--d-fast` |
| 25 | Segmented control (`.seg`) | selected background cross-fades. Sliding thumb is optional: `translateX`, `.45s --spring-bounce` | `background-color` / `transform` | `--d-state` | colour only |
| 26 | Selectable tiles ("Race against": Record / Your best / Ideal / Clock only) | ring + tint | `box-shadow`, `background-color` | `--d-fast --ease-out` | same |
| 27 | Like / react icon on a feed post | icon pops once when switched on (not when switched off); count text changes instantly | `transform: scale(.85→1)` | 350 ms `--spring-bounce` | colour only |
| 28 | Inputs focus | border colour | `border-color` | 150 ms (existing) | same |
| **Loading** |||||
| 29 | Skeletons (`Skeleton.tsx`, `.skeleton`) | shimmer sweep | `background-position` (existing 1.4 s) | infinite while loading | static block, no shimmer |
| 30 | Skeleton → content | content fades in, no slide; skip the fade when the data arrived from cache in < 100 ms | `opacity` | `--d-fast --ease-out` | same |
| 31 | Spinner | rotation | `transform` | 700 ms linear infinite | 1.2 s (existing exemption) |
| 32 | Feed: next page appended (infinite scroll) | nothing: rows just appear (no per-item stagger) | n/a | n/a | n/a |
| **Pre-drive, Drive** (all of §5 applies) |||||
| 33 | Start button (112 px circle) | press scale `.96`, ring stays static | `transform` | as 12 | none |
| 34 | Countdown lights | each light on: instant. Lights out: all off on the same frame as the GO sound and vibration | `background-color`, `box-shadow` | 0–80 ms (existing `.08s`) | same: it's information |
| 35 | Elapsed lap clock | **no animation**; `textContent` written in rAF only when the tenths change (existing `useElapsed`) | none | n/a | n/a |
| 36 | Delta number (`−0.41`) value | **no tween, no roll, no scale**; changes on the frame the controller updates | none | n/a | n/a |
| 37 | Delta colour (gain green / loss / purple) | colour | `color` | instant | instant |
| 38 | Sector pill gets timed (`tint-p/g/y`) | tint fades in once, no pulse | `background-color` | `--d-fast --ease-out`, once per sector | instant |
| 39 | Purple (fastest) sector | no extra visual flourish; the vibration pattern (`controller.ts`) is the celebration | none | n/a | n/a |
| 40 | Delta-only mode full-screen flag colour (`.dv.delta.flag-*`) | background colour | `background-color` | 120 ms linear; never flashes or repeats | instant |
| 41 | Speed / GPS chip text | none | n/a | n/a | n/a |
| 42 | Drive map following the car | Mapbox `easeTo` over the fix interval (existing) | map camera | ≈ fix interval, linear | `jumpTo` (existing) |
| 43 | Hold to stop / exit (`HoldToStop`) | fill grows under the finger; **on release it retracts** (missing today: it snaps) | `transform: scaleX(0→1)`, origin left | grow `--d-hold linear`; retract 200 ms `--ease-out` | **keep the fill** (progress = meaning) |
| 44 | Jump-start banner / notes appearing in Drive | fade only, no slide | `opacity` | `--d-fast` | instant |
| **Results, details** |||||
| 45 | Run result: "New personal best" chip | one entrance after the sheet lands | `scale(.9→1)`, `opacity` | 450 ms `--spring-bounce`, delay 250 ms | fade |
| 46 | Result/lap sector strip (`.sec.thick`) | draws left to right once | `transform: scaleX(0→1)`, origin left | 600 ms `--ease-out` | static |
| 47 | Hero route line (`hero-draw`, existing 1.6 s) | stroke draws once | `stroke-dashoffset` | shorten to 900 ms `--ease-out` | static |
| 48 | Charts (`chart-reveal`, existing 1.1 s) | clip reveal once | `clip-path` | shorten to 700 ms `--ease-out` | none (existing) |
| 49 | Route detail map hero resizing (`.route-hero .mapview` animates `height`) | **change:** animate `transform` of the sheet over the map, not the map's height | `transform` | `--d-screen --spring` | instant |
| **Ambient** |||||
| 50 | `.ph.sl/.soft::before` orbiting blobs (`orbit`, 16 s) | allowed on paddock screens only | `--orbit` → background-position (paints) | 16 s linear infinite | none (existing) |

### Never animate

- The elapsed clock, delta, speed, lap counts, times in lists, like/follower counts (no count-up, no
  digit roll). Times are data and must be readable on every frame.
- Anything on `.dv` while a lap is running, except rows 38, 40, 42 and 43.
- `backdrop-filter`/`blur()` radius (it re-samples the whole area behind each frame). Glass surfaces
  may move (`transform`) but never "materialise" by blurring in.
- Layout: `height`, `max-height` (rows 49 and `.explore-sheet` today), `width`, `top`, grid tracks.
- Scroll position (no smooth programmatic scroll on route change; `window.scrollTo(0,0)` stays instant).
- Focus rings (appear instantly).
- Map camera on first load of a screen (fit instantly; animate only when the user's action moved it).
- Feed cards on scroll (no reveal-on-scroll, no parallax).
- Error states (shown instantly; a shake is not used).

## 4. Implementation notes

**CSS vs JS.** All of §3 is CSS (classes + `transition`/`@keyframes`) except: drag sheets (rows 17–18,
`lib/pullSheet.ts`, keep), the map camera (Mapbox), the clock (rAF `textContent`), and the
View Transition for theme (`lib/theme.ts`). Don't use WAAPI unless an animation needs a JS-computed
start value; nothing here does.

**Where each belongs**
- Tokens: `src/styles/tiles.css` `:root` (§2). Replace raw values (`.45s`, `.1s`, `150ms`) with tokens
  when touching a rule; don't do a mass rewrite.
- Screen entrance (rows 1–3): `tiles.css` "motion" block + `lib/navStack.ts`. **Change:** NavTracker sets
  `data-nav="tab"` when both the old and new path are tab roots (`/`, `/explore`, `/drive`, `/routes`,
  `/u/<me>`). Add `html[data-nav="tab"] .ph > … { animation-name: ph-in }` so tabs rise instead of
  sliding sideways. Today a tab switch counts as "forward" unless the screen is `.sl/.docked`.
- Press (12–13): already in `tiles.css`. Ported Telemetry classes (`button.glass:active`, `.glass .tab:active`
  → `scale(.96)`) need the release spring: `transition: transform var(--d-screen) var(--spring)` on the
  base rule and `transition-duration: var(--d-press)` on `:active`. Add `-webkit-tap-highlight-color:
  transparent` and `touch-action: manipulation` on interactive glass if not already global.
- Modal sheet (15–16): `.sheet-b.modal` in `tiles.css`; `Sheet` already has a `leaving` state. Give the
  leaving element a class (`.leaving`) with `animation: sheet-down var(--d-exit) var(--ease-in) forwards`
  and unmount on `animationend` (keep a timeout fallback of `--d-exit` + 50 ms so it can't stick). If
  `open` turns true again mid-exit, drop `.leaving`. The entrance animation then restarts from the
  current spot, which is acceptable for a tap.
- Hold to stop (43): `tiles.css` `.dv-fill`. Add `transition: transform 200ms var(--ease-out)` on
  `.dv-fill` (retract), keep the `.holding` rule (`--d-hold linear`). Keep `--d-hold` and the 800 ms
  timeout in `Drive.tsx HoldToStop` equal. Vibrate on start and on stop (exists).
- Sector pills (38): add `transition: background-color var(--d-fast) var(--ease-out)` to the pill only
  (`.dv-pills > .glass`). Don't put it on the `.glass` base: there it would also run on paddock theme changes.
- Toast (19–20): `tiles.css` `.glass.toast`. Toast exit needs a `leaving` class like the sheet.
- Like pop (27): a class toggled for one animation (`.pop` → `animation: pop 350ms var(--spring-bounce)`),
  added only on the off→on transition.
- Result (45–46): `screens/RunSummary.tsx` result sheet; CSS `animation-delay`, `both` fill mode.

**Reduced motion: fix the global clamp.** `global.css` sets every animation and transition to 1 ms under
reduce. That (a) turns the intended 160 ms `ph-fade` fallbacks into instant cuts and (b) **makes the
hold-to-stop fill jump to full at once while the stop still takes 800 ms**. That is a functional bug for
reduced-motion drivers. Exempt what must keep its timing:
```css
/* both sides are !important; these selectors out-rank the clamp's `*`, so they win */
@media (prefers-reduced-motion: reduce) {
  .dv-hold.holding .dv-fill { transition-duration: var(--d-hold) !important; }
  .ph > :not(.dock):not(.map), .sheet-b.modal, .scrim, .glass.toast { animation-duration: var(--d-fast) !important; }
}
```
(These elements' reduced-motion rules already swap their keyframes to `ph-fade`, so only the duration
needs restoring.) Every new rule with
`transform` motion needs its own reduced variant (fade or none). Also respect
`prefers-reduced-transparency` for glass (already done in `tiles.css`).

**Performance**
- `will-change: transform` only while dragging (pullSheet `pointerdown` → set; settle `done` → clear).
  Never leave it in static CSS on lists or cards.
- The ambient `orbit` (row 50) repaints a full-viewport layer every frame (`@property` angle →
  `background-position`, which is not compositor-only). It must never run under Drive (`.dv` doesn't use
  `.ph.soft`; keep it that way). Pause it when the page is hidden (`html:has(.dv) …` or
  `document.hidden` → `animation-play-state: paused`). Keep it off on low-end Android if profiling shows
  frame drops.
- Glass with `backdrop-filter` over the moving Drive map recomposites every map frame. Drive pills and
  chips should use the solid/tinted fill (Telemetry `--g2` without blur) during a run. Check this with
  the design-port agent; it's a visual call.
- React: no state updates per animation frame. Drive values go to the DOM via refs (existing pattern);
  CSS reacts to class changes only.
- Test on the real Android build (Capacitor WebView), not only desktop Chrome: open a sheet, drag-dismiss,
  hold to stop, switch tabs quickly (each must stay interruptible).

**View Transitions API: only for the theme.** Not for route changes. The app uses `<BrowserRouter>`,
not a data router, so React Router's `viewTransition` isn't available. Screens are lazy (Suspense)
and the transition would wait for chunks. VT snapshots also block input and can't be interrupted
mid-flight, which breaks principle 3. The CSS entrance animations already give the spatial cue with
none of those costs.

**No dependency.** CSS `linear()` springs plus the existing 40-line JS spring cover everything; Motion /
Framer Motion would add ~30–50 kB for no gain here. Revisit only if shared-element transitions (a feed
card morphing into the lap screen) become a requirement. Haptics stay on `navigator.vibrate`
(works in the Android WebView). Add `@capacitor/haptics` only if vibrate proves unreliable on devices.
