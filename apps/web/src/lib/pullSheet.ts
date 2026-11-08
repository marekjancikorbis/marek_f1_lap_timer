import { useRef, type PointerEvent, type RefObject } from 'react';

/** Where a flick would come to rest (Apple's scroll-deceleration projection), in px from the release point. */
const project = (vPxPerS: number, rate = 0.998) => ((vPxPerS / 1000) * rate) / (1 - rate);

/**
 * A bottom sheet's grab handle: the sheet's height follows the finger 1:1, and on release the flick's
 * projected resting point decides open or shut. The class flips in the same frame the inline height
 * is dropped, so the CSS transition carries on from wherever the finger let go.
 */
export function usePullSheet(sheet: RefObject<HTMLElement | null>, open: boolean, setOpen: (o: boolean) => void, maxH: () => number) {
  const drag = useRef<{ y: number; h: number; dy: number; trail: { y: number; t: number }[] } | null>(null);
  const moved = useRef(false);
  return {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { y: e.clientY, h: sheet.current!.offsetHeight, dy: 0, trail: [{ y: e.clientY, t: e.timeStamp }] };
      moved.current = false;
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      const d = drag.current;
      const el = sheet.current;
      if (!d || !el) return;
      d.dy = e.clientY - d.y;
      d.trail = [...d.trail.slice(-4), { y: e.clientY, t: e.timeStamp }];
      if (!moved.current && Math.abs(d.dy) < 8) return; // a tap, not a drag
      moved.current = true;
      el.style.transition = 'none';
      el.style.maxHeight = 'none';
      const want = d.h - d.dy;
      const top = maxH();
      // Past either end the sheet resists instead of stopping dead.
      const band = (over: number) => (over * 0.55 * 300) / (300 + 0.55 * Math.abs(over));
      el.style.height = `${want > top ? top + band(want - top) : want < 80 ? 80 - band(80 - want) : want}px`;
    },
    onPointerUp(e: PointerEvent<HTMLElement>) {
      const d = drag.current;
      const el = sheet.current;
      drag.current = null;
      if (!d || !el || !moved.current) return;
      const first = d.trail[0];
      const v = ((e.clientY - first.y) / Math.max(1, e.timeStamp - first.t)) * 1000;
      const rest = d.dy + project(v);
      const opening = rest < -40 ? true : rest > 40 ? false : open;
      el.classList.toggle('open', opening);
      el.style.transition = '';
      el.style.maxHeight = '';
      el.style.height = '';
      setOpen(opening);
    },
    onClick() {
      if (moved.current) moved.current = false;
      else setOpen(!open);
    },
  };
}
