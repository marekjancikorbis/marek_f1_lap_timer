import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useEffect, useRef, useState } from 'react';
import { MAPBOX_STYLE, MAPBOX_TOKEN } from '../lib/config';
import { consume, UsageLimitError } from '../lib/usage';
import { Spinner } from './ui';

mapboxgl.accessToken = MAPBOX_TOKEN;

interface Props {
  /** Called once the style has loaded. Return a cleanup if needed. */
  onReady: (map: mapboxgl.Map) => void | (() => void);
  bounds?: [number, number, number, number];
  center?: [number, number];
  zoom?: number;
  interactive?: boolean;
  height?: number | string;
  className?: string;
  label?: string;
}

/**
 * A Mapbox map. Every mount counts one map load against the monthly cap
 * before Mapbox is contacted; at the cap the app's limit screen takes over.
 */
export function MapView({ onReady, bounds, center, zoom = 12, interactive = true, height = 280, className, label }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'limited' | 'error'>('loading');
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useEffect(() => {
    let map: mapboxgl.Map | null = null;
    let cleanup: void | (() => void);
    let cancelled = false;
    let giveUp = 0;
    let resize: ResizeObserver | null = null;
    (async () => {
      try {
        await consume('mapLoads');
      } catch (e) {
        if (!cancelled) setState(e instanceof UsageLimitError ? 'limited' : 'error');
        return;
      }
      if (cancelled || !el.current) return;
      // Start from a centre and fit the bounds once loaded: passing bounds to the constructor
      // throws "failed to invert matrix" in Mapbox GL 3, so 'load' never fired.
      map = new mapboxgl.Map({
        container: el.current,
        style: MAPBOX_STYLE,
        center: bounds ? [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2] : center,
        zoom,
        interactive,
        attributionControl: false,
        cooperativeGestures: false,
        pitchWithRotate: false,
      });
      map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
      // Mapbox only follows window resizes: redraw when the container itself changes size or is unhidden.
      resize = new ResizeObserver(() => map?.resize());
      resize.observe(el.current);
      // Never spin forever: no signal, blocked token or a Mapbox failure ends here.
      giveUp = window.setTimeout(() => !cancelled && setState((s) => (s === 'loading' ? 'error' : s)), 20_000);
      map.on('load', () => {
        if (cancelled || !map) return;
        window.clearTimeout(giveUp);
        if (bounds) map.fitBounds(bounds, { padding: 40, duration: 0 });
        setState('ready');
        cleanup = readyRef.current(map);
      });
      map.on('error', (ev) => {
        if ((ev.error as { status?: number })?.status === 401) setState('error');
      });
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(giveUp);
      resize?.disconnect();
      if (typeof cleanup === 'function') cleanup();
      map?.remove();
    };
    // The map is created once per mount; later prop changes go through onReady's map handle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`mapview ${className ?? ''}`} style={{ height, position: 'relative' }} role="region" aria-label={label ?? 'Map'}>
      <div ref={el} style={{ position: 'absolute', inset: 0 }} />
      {state === 'loading' && (
        <div className="map-overlay">
          <Spinner label="Loading map" />
        </div>
      )}
      {state === 'limited' && <div className="map-overlay">Map limit reached for this month.</div>}
      {state === 'error' && <div className="map-overlay">The map could not load.</div>}
    </div>
  );
}

/** Add or replace a GeoJSON source. */
export function setSource(map: mapboxgl.Map, id: string, data: GeoJSON.FeatureCollection | GeoJSON.Feature) {
  const src = map.getSource(id) as mapboxgl.GeoJSONSource | undefined;
  if (src) src.setData(data);
  else map.addSource(id, { type: 'geojson', data });
}
