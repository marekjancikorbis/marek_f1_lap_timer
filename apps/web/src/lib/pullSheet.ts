import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';

/** Where a flick would come to rest (Apple's scroll-deceleration projection), in px from the release point. */
export const project = (vPxPerS: number, rate = 0.998) => ((vPxPerS / 1000) * rate) / (1 - rate);

/** Past either end the sheet resists more the further it goes, instead of stopping dead. */
export const band = (over: number, dim = 300, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A spring on one value, from where it is now and as fast as it is moving now, so a flick carries straight into
 * the settle. Damping 0.85 and response 0.38 s: a sheet that was thrown overshoots a hair and settles; one that
 * was let go slowly just glides in. Returns a stop function, so a new touch can catch it mid-flight.
 */
export function spring(from: number, to: number, v0: number, frame: (x: number) => void, done: () => void) {
  if (still()) {
    frame(to);
    done();
    return () => undefined;
  }
  const response = 0.38;
  const damping = 0.85;
  const k = (2 * Math.PI / response) ** 2;
  const c = (4 * Math.PI * damping) / response;
  let x = from;
  let v = v0;
  let last = performance.now();
  let raf = 0;
  const step = (now: number) => {
    const dt = Math.min(0.032, (now - last) / 1000) / 4;
    last = now;
    for (let i = 0; i < 4; i++) {
      v += (-k * (x - to) - c * v) * dt;
      x += v * dt;
    }
    if (Math.abs(x - to) < 0.5 && Math.abs(v) < 20) {
      frame(to);
      done();
      return;
    }
    frame(x);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

/**
 * A bottom sheet you pull up and down (Explore, a route). It slides: the sheet is always laid out at its full
 * height and only moves (transform), so nothing re-lays-out while it goes, which is what kept it smooth on
 * Android. Shut, it sits lowered so only its top shows: down to the element marked `data-peek` (or its whole
 * content, if short), at most the CSS `--peek-max` share of the screen.
 *
 * It follows the finger 1:1 from anywhere on it; inside its list, a drag scrolls the list, except pulling
 * down with the list at the top, which takes the sheet. Past either end it resists. On release the flick's
 * projected resting point picks open or shut, and a spring carries on from the finger's position and speed.
 * A touch while it's moving catches it where it is (its on-screen position, not where it was going).
 *
 * The list inside is `.xs-body`, the handle `.xs-pull`; the class `open` is the open resting place.
 */
export function usePullSheet(sheet: MutableRefObject<HTMLElement | null>, open: boolean, setOpen: (o: boolean) => void, enabled = true) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const ref = useCallback(
    (el: HTMLElement | null) => {
      sheet.current = el;
      setNode(el);
    },
    [sheet],
  );
  const live = useRef({ open, setOpen, enabled });
  live.current = { open, setOpen, enabled };
  const stopSpring = useRef<(() => void) | null>(null);
  const dragged = useRef(false);
  /** Where a running settle is taking the sheet, so a tap mid-way reverses that, not the last resting state. */
  const heading = useRef<boolean | null>(null);

  useEffect(() => {
    const el = node;
    if (!el) return;
    /** How far down the shut sheet sits. */
    let shut = 0;
    const measure = () => {
      const parent = el.parentElement?.clientHeight ?? window.innerHeight;
      const css = getComputedStyle(el);
      const max = parent * (parseFloat(css.getPropertyValue('--peek-max')) || 0.4);
      const top = el.getBoundingClientRect().top;
      const pad = parseFloat(css.paddingBottom) || 0;
      const marker = el.querySelector('[data-peek]');
      // Without a marker: down to the end of what's in the list (the list's own box fills the sheet).
      const last = marker ?? el.querySelector('.xs-body')?.lastElementChild ?? el.querySelector('.xs-pull');
      const natural = last ? last.getBoundingClientRect().bottom - top + pad : max;
      const peek = Math.max(72, Math.min(max, natural));
      shut = Math.max(0, Math.round(el.offsetHeight - peek));
      el.style.setProperty('--shut', `${shut}px`);
    };
    let pending = 0;
    const remeasure = () => {
      pending ||= requestAnimationFrame(() => {
        pending = 0;
        measure();
      });
    };
    measure();
    const sizes = new ResizeObserver(remeasure);
    sizes.observe(el);
    const list = el.querySelector('.xs-body');
    if (list) sizes.observe(list);
    // Results and leaderboards arrive after the sheet: the peek follows its content.
    const content = new MutationObserver(remeasure);
    content.observe(el, { childList: true, subtree: true });

    /** Where the sheet is on screen right now (mid-transition included), px below open. */
    const now = () => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42;
    const place = (y: number) => {
      el.style.transition = 'none';
      el.style.transform = `translateY(${y}px)`;
    };
    const rest = (opened: boolean) => {
      el.classList.toggle('open', opened);
      el.style.transform = '';
      el.style.transition = '';
      live.current.setOpen(opened);
    };

    let g: { y0: number; off0: number; mode: 'pending' | 'drag' | 'scroll'; grab: boolean; trail: { y: number; t: number }[] } | null = null;
    const start = (y: number, t: number, target: EventTarget | null) => {
      if (!live.current.enabled) return;
      const caught = !!stopSpring.current || el.getAnimations().length > 0;
      stopSpring.current?.();
      stopSpring.current = null;
      const off = now();
      if (caught) place(off); // caught mid-move: it stays under the finger
      g = { y0: y, off0: off, mode: caught ? 'drag' : 'pending', grab: !!(target as Element | null)?.closest?.('.xs-pull'), trail: [{ y, t }] };
    };
    const move = (y: number, t: number, e: Event) => {
      if (!g) return;
      const dy = y - g.y0;
      if (g.mode === 'pending') {
        if (Math.abs(dy) < 8) return; // a tap, or not yet clear which way
        const body = el.querySelector<HTMLElement>('.xs-body');
        const atTop = !body || body.scrollTop <= 0;
        const takeSheet = g.grab || !live.current.open || (dy > 0 && atTop);
        g.mode = takeSheet ? 'drag' : 'scroll';
        if (!takeSheet) return;
        // Track from here on, so the 8 px of hysteresis doesn't make the sheet jump.
        g.y0 = y;
        g.off0 = now();
      }
      if (g.mode !== 'drag') return;
      if (e.cancelable) e.preventDefault();
      g.trail = [...g.trail.filter((p) => t - p.t < 100), { y, t }];
      const want = g.off0 + (y - g.y0);
      place(want < 0 ? -band(-want) : want > shut ? shut + band(want - shut) : want);
    };
    const end = (t: number) => {
      if (!g) return;
      const was = g;
      g = null;
      if (was.mode !== 'drag') return;
      const first = was.trail[0];
      const last = was.trail[was.trail.length - 1];
      // Finger speed over the last 100 ms, px/s, downward positive.
      const v = t - first.t > 0 ? ((last.y - first.y) / (t - first.t)) * 1000 : 0;
      const from = now();
      const opened = from + project(v) < shut / 2;
      heading.current = opened;
      stopSpring.current = spring(from, opened ? 0 : shut, v, place, () => {
        stopSpring.current = null;
        heading.current = null;
        rest(opened);
      });
      dragged.current = true;
      window.setTimeout(() => (dragged.current = false), 0);
    };

    const ts = (e: TouchEvent) => e.touches.length === 1 && start(e.touches[0].clientY, e.timeStamp, e.target);
    const tm = (e: TouchEvent) => move(e.touches[0].clientY, e.timeStamp, e);
    const te = (e: TouchEvent) => end(e.timeStamp);
    // A mouse drags by the handle only, so text in the sheet stays selectable.
    const pd = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || !(e.target as Element).closest('.xs-pull')) return;
      start(e.clientY, e.timeStamp, e.target);
      const pm = (ev: PointerEvent) => move(ev.clientY, ev.timeStamp, ev);
      const pu = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', pm);
        window.removeEventListener('pointerup', pu);
        end(ev.timeStamp);
      };
      window.addEventListener('pointermove', pm);
      window.addEventListener('pointerup', pu);
    };
    el.addEventListener('touchstart', ts, { passive: true });
    el.addEventListener('touchmove', tm, { passive: false });
    el.addEventListener('touchend', te);
    el.addEventListener('touchcancel', te);
    el.addEventListener('pointerdown', pd);
    return () => {
      el.removeEventListener('touchstart', ts);
      el.removeEventListener('touchmove', tm);
      el.removeEventListener('touchend', te);
      el.removeEventListener('touchcancel', te);
      el.removeEventListener('pointerdown', pd);
      sizes.disconnect();
      content.disconnect();
      cancelAnimationFrame(pending);
      stopSpring.current?.();
    };
  }, [node]);

  /** The handle's tap: open or shut. The CSS transition starts from wherever the sheet is (tiles.css). */
  const toggle = () => {
    const el = sheet.current;
    if (!el || dragged.current || !live.current.enabled) return;
    const towards = heading.current ?? live.current.open;
    stopSpring.current?.();
    stopSpring.current = null;
    heading.current = null;
    el.classList.toggle('open', towards);
    el.style.transform = '';
    el.style.transition = '';
    el.classList.toggle('open', !towards);
    live.current.setOpen(!towards);
  };
  return { ref, onClick: toggle };
}
