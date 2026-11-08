import type mapboxgl from 'mapbox-gl';

/**
 * Colours the base map in the theme, as the mockups do: grey it, brighten it, then give it the theme's tint
 * (CSS `filter: var(--map-filter)` under a `mix-blend-mode: color` layer of `--map-tint`). Done to the style's
 * own colours rather than with CSS on the canvas, so routes and sector colours drawn on top stay true.
 */

type RGBA = [number, number, number, number];

const ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;

/** Any CSS colour to 0..1 RGBA, or null when the string isn't a colour (an expression keyword, a label). */
export function parseColour(c: string): RGBA | null {
  if (!ctx || !c || c.length > 64) return null;
  ctx.fillStyle = '#010203';
  ctx.fillStyle = c;
  const v = ctx.fillStyle;
  if (v === '#010203' && !/^#010203$/i.test(c.trim())) return null;
  if (v.startsWith('#')) return [parseInt(v.slice(1, 3), 16) / 255, parseInt(v.slice(3, 5), 16) / 255, parseInt(v.slice(5, 7), 16) / 255, 1];
  const m = v.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b, a = '1'] = m[1].split(',').map((s) => s.trim());
  return [Number(r) / 255, Number(g) / 255, Number(b) / 255, Number(a)];
}

// mix-blend-mode: color, from the Compositing spec: the tint's hue and saturation at the base's luminosity.
const lum = (c: number[]) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
function clip(c: number[]) {
  const l = lum(c);
  const n = Math.min(...c);
  const x = Math.max(...c);
  if (n < 0) c = c.map((v) => l + ((v - l) * l) / (l - n));
  if (x > 1) c = c.map((v) => l + ((v - l) * (1 - l)) / (x - l));
  return c;
}
const setLum = (c: number[], l: number) => clip(c.map((v) => v + (l - lum(c))));

export function tintColour([r, g, b, a]: RGBA, tint: RGBA, brightness: number): RGBA {
  // filter: grayscale(1) brightness(b)
  const grey = Math.min(1, (0.2126 * r + 0.7152 * g + 0.0722 * b) * brightness);
  const [tr, tg, tb] = setLum([tint[0], tint[1], tint[2]], grey);
  return [tr, tg, tb, a];
}

const css = ([r, g, b, a]: RGBA) => `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${+a.toFixed(3)})`;

function walk(v: unknown, f: (c: RGBA) => RGBA): unknown {
  if (typeof v === 'string') {
    const c = parseColour(v);
    return c ? css(f(c)) : v;
  }
  if (Array.isArray(v)) return v.map((x) => walk(x, f));
  if (v && typeof v === 'object' && Array.isArray((v as { stops?: unknown[] }).stops))
    return { ...(v as object), stops: (v as { stops: unknown[] }).stops.map((s) => walk(s, f)) };
  return v;
}

/** The style's own colours, kept so a theme change recolours from the original and not from the last tint. */
const originals = new WeakMap<mapboxgl.Map, { id: string; prop: string; value: unknown }[]>();

/** Recolour the base map's layers in the current theme. Call once the style has loaded, before adding own layers. */
export function tintMap(map: mapboxgl.Map) {
  if (!originals.has(map)) {
    const list: { id: string; prop: string; value: unknown }[] = [];
    for (const layer of map.getStyle()?.layers ?? []) {
      const paint = (layer as { paint?: Record<string, unknown> }).paint ?? {};
      for (const [prop, value] of Object.entries(paint)) if (prop.endsWith('-color')) list.push({ id: layer.id, prop, value });
    }
    originals.set(map, list);
  }
  const root = getComputedStyle(document.documentElement);
  const tint = parseColour(root.getPropertyValue('--map-tint').trim());
  const brightness = Number(root.getPropertyValue('--map-filter').match(/brightness\(([\d.]+)\)/)?.[1] ?? 1);
  if (!tint) return;
  for (const { id, prop, value } of originals.get(map)!) {
    try {
      map.setPaintProperty(id, prop as never, walk(value, (c) => tintColour(c, tint, brightness)) as never);
    } catch {
      // A layer whose colour can't take the rewritten value keeps the style's own colour.
    }
  }
}
