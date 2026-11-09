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
 * A bottom sheet you pull up and down (Explore, a route). The sheet follows the finger 1:1 from anywhere on
 * it; inside its list, a drag scrolls the list, except pulling down with the list at the top, which takes the
 * sheet. On release the flick's projected resting point picks open or shut, and a spring carries on from the
 * finger's position and speed. A touch during the settle catches the sheet where it is.
 *
 * The sheet's CSS gives the two resting heights (class `open`); the list inside is `.xs-body`, the handle `.xs-pull`.
 */
export function usePullSheet(sheet: MutableRefObject<HTMLElement | null>, open: boolean, setOpen: (o: boolean) => void, enabled = true) {
  // The sheet may appear after the first render (a screen loading first): listen from when it exists.
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

  useEffect(() => {
    const el = node;
    if (!el) return;
    let g: { y0: number; h0: number; mode: 'pending' | 'drag' | 'scroll'; grab: boolean; trail: { y: number; t: number }[] } | null = null;

    /** The sheet's resting height, open or shut, read from its CSS. */
    const restingHeight = (opened: boolean) => {
      const had = el.classList.contains('open');
      const { height, maxHeight } = el.style;
      el.classList.toggle('open', opened);
      el.style.height = '';
      el.style.maxHeight = '';
      const h = el.offsetHeight;
      el.classList.toggle('open', had);
      el.style.height = height;
      el.style.maxHeight = maxHeight;
      return h;
    };
    const hold = (h: number) => {
      el.style.transition = 'none';
      el.style.maxHeight = 'none';
      el.style.height = `${h}px`;
    };
    const release = (opened: boolean) => {
      el.classList.toggle('open', opened);
      el.style.height = '';
      el.style.maxHeight = '';
      el.style.transition = '';
      live.current.setOpen(opened);
    };
    /** Settle from the current height at this speed (px/s, positive = growing) to the nearest resting height. */
    const settle = (v: number) => {
      const shut = restingHeight(false);
      const full = restingHeight(true);
      const h = el.offsetHeight;
      const rest = h + project(v);
      const opened = Math.abs(rest - full) < Math.abs(rest - shut);
      stopSpring.current = spring(h, opened ? full : shut, v, (x) => (el.style.height = `${x}px`), () => {
        stopSpring.current = null;
        release(opened);
      });
    };

    const start = (y: number, t: number, target: EventTarget | null) => {
      if (!live.current.enabled) return;
      const caught = !!stopSpring.current;
      stopSpring.current?.();
      stopSpring.current = null;
      if (caught) hold(el.offsetHeight); // caught mid-settle: it stays under the finger
      g = { y0: y, h0: el.offsetHeight, mode: caught ? 'drag' : 'pending', grab: !!(target as Element | null)?.closest?.('.xs-pull'), trail: [{ y, t }] };
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
        g.h0 = el.offsetHeight;
        hold(g.h0);
      }
      if (g.mode !== 'drag') return;
      if (e.cancelable) e.preventDefault();
      g.trail = [...g.trail.filter((p) => t - p.t < 100), { y, t }];
      const shut = 80;
      const top = (el.parentElement?.clientHeight ?? 800) * 0.92;
      const want = g.h0 - (y - g.y0);
      el.style.height = `${want > top ? top + band(want - top) : want < shut ? shut - band(shut - want) : want}px`;
    };
    const end = (t: number) => {
      if (!g) return;
      const was = g;
      g = null;
      if (was.mode !== 'drag') return;
      const first = was.trail[0];
      const last = was.trail[was.trail.length - 1];
      // Finger speed over the last 100 ms; the sheet grows as the finger moves up.
      const v = t - first.t > 0 ? -((last.y - first.y) / (t - first.t)) * 1000 : 0;
      settle(v);
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
      stopSpring.current?.();
    };
  }, [node]);

  /** The handle's tap: open or shut with the same spring (a drag that ends on the handle isn't a tap). */
  const toggle = () => {
    const el = sheet.current;
    if (!el || dragged.current || !live.current.enabled) return;
    stopSpring.current?.();
    const opened = !live.current.open;
    const from = el.offsetHeight;
    el.style.transition = 'none';
    el.classList.toggle('open', opened);
    el.style.height = '';
    el.style.maxHeight = '';
    const to = el.offsetHeight;
    el.classList.toggle('open', !opened);
    el.style.maxHeight = 'none';
    el.style.height = `${from}px`;
    stopSpring.current = spring(from, to, 0, (x) => (el.style.height = `${x}px`), () => {
      stopSpring.current = null;
      el.classList.toggle('open', opened);
      el.style.height = '';
      el.style.maxHeight = '';
      el.style.transition = '';
      live.current.setOpen(opened);
    });
  };
  return { ref, onClick: toggle };
}
