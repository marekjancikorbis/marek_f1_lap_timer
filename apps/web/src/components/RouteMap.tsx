import type mapboxgl from 'mapbox-gl';
import { useCallback, useEffect, useRef } from 'react';
import { preparedFor, sectorLines } from '../lib/geo';
import type { Route, SectorColourName } from '../lib/types';
import { MapView } from './MapView';

const HEX: Record<SectorColourName | 'none', string> = { purple: '#8b3fe0', green: '#1fa64f', yellow: '#f5cf19', none: '#f2f1ec' };

/** Route on a Mapbox map, sectors stroked in flag colours, start flagged; optionally a car at a distance. */
export function RouteMap({
  route,
  colours,
  height = 260,
  extra,
  carAtM,
}: {
  route: Route;
  colours?: (SectorColourName | null)[];
  height?: number | string;
  extra?: (map: mapboxgl.Map) => void | (() => void);
  /** Metres from the start to place the car marker; null hides it. */
  carAtM?: number | null;
}) {
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const carRef = useRef(carAtM);
  carRef.current = carAtM;

  const placeCar = useCallback(
    (map: mapboxgl.Map, d: number | null | undefined) => {
      const src = map.getSource('car') as mapboxgl.GeoJSONSource | undefined;
      if (!src) return;
      if (d == null) return src.setData({ type: 'FeatureCollection', features: [] });
      const p = preparedFor(route).pointAt(d);
      src.setData({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } });
      // Keep the car in view when the route runs off the visible map.
      if (!map.getBounds()?.contains([p.lon, p.lat])) map.easeTo({ center: [p.lon, p.lat], duration: 300 });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [route.id],
  );

  useEffect(() => {
    if (mapRef.current) placeCar(mapRef.current, carAtM);
  }, [carAtM, placeCar]);

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
        paint: { 'circle-radius': 8, 'circle-color': '#f2f1ec', 'circle-stroke-color': '#0c0d0e', 'circle-stroke-width': 3 },
      });
      map.addSource('car', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'car',
        type: 'circle',
        source: 'car',
        paint: { 'circle-radius': 9, 'circle-color': '#2f7de1', 'circle-stroke-color': '#f2f1ec', 'circle-stroke-width': 3 },
      });
      placeCar(map, carRef.current);
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
