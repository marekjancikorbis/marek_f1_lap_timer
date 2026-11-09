/**
 * Liquid glass: real refraction for every glass surface, not just blur. Each surface gets an SVG displacement
 * map shaped to its own size and corner radius, used in its backdrop-filter (CSS `--lens`, see tiles.css). The
 * map models a convex glass slab with a squircle bevel: flat in the middle (the background shows through
 * undisturbed), bending strongly toward the rim, so what's behind it curves in at the edges like thick glass.
 *
 * Only Chromium draws SVG filters in backdrop-filter (Chrome, Edge, the Android app's WebView); elsewhere the
 * glass keeps its plain blur. Reduced transparency turns glass solid, so no lens is needed there either.
 */

const NS = 'http://www.w3.org/2000/svg';
/** Px of background the rim pulls in from at most. */
const STRENGTH = 26;
/** Big surfaces (sheets being dragged) share maps at this step, so a drag doesn't build one per frame. */
const step = (v: number) => (v > 240 ? 24 : 4);
const q = (v: number) => Math.max(8, Math.round(v / step(v)) * step(v));

function supported() {
  const brands = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands ?? [];
  // Brands when the browser reports them; otherwise its user agent (iOS browsers are all WebKit: no lens).
  const chromium = brands.length ? brands.some((b) => /Chromium/.test(b.brand)) : /Chrome\/\d/.test(navigator.userAgent) && !/CriOS|EdgiOS|Firefox/.test(navigator.userAgent);
  return chromium && !matchMedia('(prefers-reduced-transparency: reduce)').matches;
}

/**
 * The displacement map for a w x h rounded rectangle: red = x offset, green = y offset, 128 = none.
 * Each pixel samples from further toward the middle, more the closer it is to the rim.
 */
export function lensMap(w: number, h: number, r: number): ImageData {
  const img = new ImageData(w, h);
  const d = img.data;
  // Neutral everywhere first (128, 128, 128, 255); only the rim band is worked out pixel by pixel.
  new Uint32Array(d.buffer).fill(0xff808080);
  const bezel = Math.max(6, Math.min(30, Math.min(w, h) * 0.32));
  const band = Math.ceil(Math.max(bezel, r));
  const cx = w / 2;
  const cy = h / 2;
  const hx = cx - r;
  const hy = cy - r;
  const pixel = (x: number, y: number) => {
    // Signed distance to the rounded rectangle's edge (negative inside) and the outward normal.
    const px = Math.abs(x + 0.5 - cx) - hx;
    const py = Math.abs(y + 0.5 - cy) - hy;
    let nx: number;
    let ny: number;
    let dist: number;
    if (px > 0 && py > 0) {
      const len = Math.hypot(px, py) || 1;
      nx = px / len;
      ny = py / len;
      dist = r - len;
    } else if (px > py) {
      nx = 1;
      ny = 0;
      dist = r - px;
    } else {
      nx = 0;
      ny = 1;
      dist = r - py;
    }
    if (dist >= bezel) return;
    nx *= Math.sign(x + 0.5 - cx) || 1;
    ny *= Math.sign(y + 0.5 - cy) || 1;
    // Squircle bevel: height (1 - (1 - t)^4)^(1/4); the bend is where the surface slopes, i.e. near the rim.
    const t = Math.max(0, dist / bezel);
    const bend = 1 - Math.pow(1 - Math.pow(1 - t, 4), 0.25);
    const i = (y * w + x) * 4;
    d[i] = 128 - nx * bend * 127;
    d[i + 1] = 128 - ny * bend * 127;
  };
  for (let y = 0; y < h; y++) {
    if (y < band || y >= h - band) for (let x = 0; x < w; x++) pixel(x, y);
    else
      for (let x = 0; x < Math.min(band, w); x++) {
        pixel(x, y);
        pixel(w - 1 - x, y);
      }
  }
  return img;
}

let svg: SVGSVGElement | null = null;
/** Ready filters by shape, and shapes being built (their image encodes off the main thread). */
const made = new Map<string, string>();
const building = new Map<string, Promise<string>>();

/** Room for the surface to grow between rebuilds (a sheet being pulled up): beyond the map, no bending. */
const SLACK = 400;

function filterFor(w: number, h: number, r: number): string | Promise<string> {
  const key = `${w}x${h}r${r}`;
  const hit = made.get(key) ?? building.get(key);
  if (hit) return hit;
  if (!svg) {
    svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    document.body.appendChild(svg);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.putImageData(lensMap(w, h, r), 0, 0);
  const id = `lens-${key}`;
  const job = new Promise<Blob | null>((res) => canvas.toBlob(res)).then((blob) => {
    const f = document.createElementNS(NS, 'filter');
    f.id = id;
    f.setAttribute('x', '0');
    f.setAttribute('y', '0');
    f.setAttribute('width', String(w + SLACK));
    f.setAttribute('height', String(h + SLACK));
    f.setAttribute('filterUnits', 'userSpaceOnUse');
    f.setAttribute('color-interpolation-filters', 'sRGB');
    const el = (tag: string, attrs: Record<string, string>, parent: Element = f) => {
      const e = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      parent.appendChild(e);
      return e;
    };
    // Neutral grey under the map, so anything past it (a surface still growing) shows unbent.
    el('feFlood', { 'flood-color': 'rgb(128,128,128)', result: 'flat' });
    el('feImage', { href: blob ? URL.createObjectURL(blob) : '', x: '0', y: '0', width: String(w), height: String(h), preserveAspectRatio: 'none', result: 'rim' });
    const merge = el('feMerge', { result: 'map' });
    el('feMergeNode', { in: 'flat' }, merge);
    el('feMergeNode', { in: 'rim' }, merge);
    el('feDisplacementMap', { in: 'SourceGraphic', in2: 'map', scale: String(STRENGTH * 2), xChannelSelector: 'R', yChannelSelector: 'G' });
    svg!.appendChild(f);
    building.delete(key);
    made.set(key, id);
    // shortcut: keeps up to 80 shapes; drop the oldest beyond that (a long session of resizing sheets).
    if (made.size > 80) {
      const [oldKey, oldId] = made.entries().next().value as [string, string];
      made.delete(oldKey);
      const old = document.getElementById(oldId);
      const href = old?.querySelector('feImage')?.getAttribute('href');
      if (href) URL.revokeObjectURL(href);
      old?.remove();
    }
    return id;
  });
  building.set(key, job);
  return job;
}

/** Give one surface the lens for its current size; until a new shape is ready it keeps the one it has. */
function fit(el: HTMLElement) {
  const w = q(el.offsetWidth);
  const h = q(el.offsetHeight);
  if (!el.offsetWidth || !el.offsetHeight) return;
  const r = Math.round(Math.min(w / 2, h / 2, parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0));
  const key = `${w}x${h}r${r}`;
  el.dataset.lens = key;
  const apply = (id: string) => el.dataset.lens === key && el.style.setProperty('--lens', `url(#${id})`);
  const got = filterFor(w, h, r);
  if (typeof got === 'string') apply(got);
  else void got.then(apply);
}

const SURFACES = '.glass, .dock';
/**
 * Sheets get no lens. Chrome on Android draws SVG filters in backdrop-filter on the CPU, and a sheet is
 * big and changes size every frame of a drag: refracting it made sheets lag badly. Bars, buttons and tiles
 * (small, and still while you look at them) keep it; sheets keep the clear glass without the bent rim.
 */
const NO_LENS = '.sheet, .xs, .rs, .modal';
const wants = (el: Element) => !el.matches(NO_LENS);

/** Watch the page: every glass surface, now and later, gets a lens that follows its size. */
export function startLiquidGlass() {
  if (typeof window === 'undefined' || !supported()) return;
  document.documentElement.classList.add('lens');
  const queue = new Set<HTMLElement>();
  let raf = 0;
  const flush = () => {
    raf = 0;
    for (const el of queue) if (el.isConnected) fit(el);
    queue.clear();
  };
  const later = (el: HTMLElement) => {
    queue.add(el);
    raf ||= requestAnimationFrame(flush);
  };
  const sizes = new ResizeObserver((entries) => entries.forEach((e) => later(e.target as HTMLElement)));
  const watch = (root: ParentNode) => {
    root.querySelectorAll<HTMLElement>(SURFACES).forEach((el) => {
      if (!wants(el)) return;
      sizes.observe(el);
      later(el);
    });
  };
  new MutationObserver((list) => {
    for (const m of list)
      for (const n of m.addedNodes)
        if (n instanceof HTMLElement) {
          if (n.matches(SURFACES) && wants(n)) {
            sizes.observe(n);
            later(n);
          }
          watch(n);
        }
  }).observe(document.body, { childList: true, subtree: true });
  watch(document);
}

if (import.meta.env.DEV) {
  // Middle untouched, rim pulls inward (left edge samples to the right).
  const m = lensMap(100, 60, 20).data;
  const at = (x: number, y: number) => m[(y * 100 + x) * 4];
  console.assert(at(50, 30) === 128 && at(0, 30) > 200 && at(99, 30) < 56, 'lens map bends inward at the rim only');
}
