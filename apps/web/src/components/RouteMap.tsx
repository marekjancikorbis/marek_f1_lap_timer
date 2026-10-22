import type mapboxgl from 'mapbox-gl';
import { useCallback, useEffect, useRef } from 'react';
import { preparedFor, sectorLines } from '../lib/geo';
import type { Route, SectorColourName } from '../lib/types';
import { MapView } from './MapView';

const HEX: Record<SectorColourName | 'none', string> = { purple: '#8b3fe0', green: '#1fa64f', yellow: '#f5cf19', none: '#eef1f5' };

/** Route on a Mapbox map, sectors stroked in flag colours, start flagged; optionally a car at a distance. */
export function RouteMap({
  route,
  colours,
  height = 260,
  extra,
  carAtM,
  ghostAtM,
  follow,
  onPick,
}: {
  route: Route;
  colours?: (SectorColourName | null)[];
  height?: number | string;
  extra?: (map: mapboxgl.Map) => void | (() => void);
  /** Metres from the start to place the car marker; null hides it. */
  carAtM?: number | null;
  /** Metres from the start for a hollow second car (the lap compared with); null hides it. */
  ghostAtM?: number | null;
  /** Keep the map centred on the car or the ghost; null shows the whole route. */
  follow?: 'car' | 'ghost' | null;
  /** Called with the distance along the route when the route line is tapped. */
  onPick?: (d: number) => void;
}) {
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const carRef = useRef(carAtM);
  carRef.current = carAtM;
  const ghostRef = useRef(ghostAtM);
  ghostRef.current = ghostAtM;
  const followRef = useRef(follow);
  followRef.current = follow;

  const placeCar = useCallback(
    (map: mapboxgl.Map, d: number | null | undefined, source = 'car') => {
      const src = map.getSource(source) as mapboxgl.GeoJSONSource | undefined;
      if (!src) return;
      if (d == null) return src.setData({ type: 'FeatureCollection', features: [] });
      const p = preparedFor(route).pointAt(d);
      src.setData({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } });
      if (followRef.current === source) map.jumpTo({ center: [p.lon, p.lat] });
      // Keep the car in view when the route runs off the visible map.
      else if (source === 'car' && !followRef.current && !map.getBounds()?.contains([p.lon, p.lat])) map.easeTo({ center: [p.lon, p.lat], duration: 300 });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [route.id],
  );

  useEffect(() => {
    if (mapRef.current) placeCar(mapRef.current, carAtM);
  }, [carAtM, placeCar]);

  useEffect(() => {
    if (mapRef.current) placeCar(mapRef.current, ghostAtM, 'ghost');
  }, [ghostAtM, placeCar]);

  // Zoom in on the followed dot, or back out to the whole route.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const d = follow === 'car' ? carRef.current : follow === 'ghost' ? ghostRef.current : null;
    if (follow && d != null) {
      const p = preparedFor(route).pointAt(d);
      map.jumpTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 16) });
    } else if (!follow) map.fitBounds(route.bbox, { padding: 40, duration: 400 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow]);

  const onReady = useCallback(
    (map: mapboxgl.Map) => {
      mapRef.current = map;
      const lines = sectorLines(route, 8);
      map.addSource('sectors', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: lines.map((l, i) => ({
            type: 'Feature',
            properties: { color: HEX[colours?.[i] ?? 'none'], k: i },
            geometry: { type: 'LineString', coordinates: l.map((p) => [p.lng, p.lat]) },
          })),
        },
      });
      map.addLayer({ id: 'sec-casing', type: 'line', source: 'sectors', paint: { 'line-color': '#0c0d0e', 'line-width': 9 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      map.addLayer({ id: 'sec', type: 'line', source: 'sectors', paint: { 'line-color': ['get', 'color'], 'line-width': 5 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      map.addSource('start', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [route.start.lng, route.start.lat] } },
      });
      map.addLayer({
        id: 'start',
        type: 'circle',
        source: 'start',
        paint: { 'circle-radius': 8, 'circle-color': '#eef1f5', 'circle-stroke-color': '#0c0d0e', 'circle-stroke-width': 3 },
      });
      map.addSource('ghost', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'ghost',
        type: 'circle',
        source: 'ghost',
        paint: { 'circle-radius': 8, 'circle-color': '#0c0e12', 'circle-opacity': 0.6, 'circle-stroke-color': '#eef1f5', 'circle-stroke-width': 3 },
      });
      map.addSource('car', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'car',
        type: 'circle',
        source: 'car',
        paint: { 'circle-radius': 9, 'circle-color': '#2f86ff', 'circle-stroke-color': '#eef1f5', 'circle-stroke-width': 3 },
      });
      placeCar(map, carRef.current);
      placeCar(map, ghostRef.current, 'ghost');
      // Taps within a finger's width of the line count; elsewhere the map just pans.
      map.on('click', (e) => {
        if (!pickRef.current) return;
        const { x, y } = e.point;
        if (!map.queryRenderedFeatures([[x - 16, y - 16], [x + 16, y + 16]], { layers: ['sec'] }).length) return;
        const pr = preparedFor(route);
        pickRef.current(Math.max(0, Math.min(pr.lengthM, pr.project({ lat: e.lngLat.lat, lon: e.lngLat.lng }).s)));
      });
      map.on('mouseenter', 'sec', () => pickRef.current && (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'sec', () => (map.getCanvas().style.cursor = ''));
      const cleanup = extra?.(map);
      return () => {
        mapRef.current = null;
        cleanup?.();
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [route.id],
  );
  return <MapView onReady={onReady} bounds={route.bbox} height={height} label={`Map of ${route.name}`} />;
}
