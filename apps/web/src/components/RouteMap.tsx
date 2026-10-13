import type mapboxgl from 'mapbox-gl';
import { useCallback } from 'react';
import { sectorLines } from '../lib/geo';
import type { Route, SectorColourName } from '../lib/types';
import { MapView } from './MapView';

const HEX: Record<SectorColourName | 'none', string> = { purple: '#8b3fe0', green: '#1fa64f', yellow: '#f5cf19', none: '#f2f1ec' };

/** Route on a Mapbox map, sectors stroked in flag colours, start flagged. */
export function RouteMap({
  route,
  colours,
  height = 260,
  extra,
}: {
  route: Route;
  colours?: (SectorColourName | null)[];
  height?: number | string;
  extra?: (map: mapboxgl.Map) => void | (() => void);
}) {
  const onReady = useCallback(
    (map: mapboxgl.Map) => {
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
      return extra?.(map);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [route.id],
  );
  return <MapView onReady={onReady} bounds={route.bbox} height={height} label={`Map of ${route.name}`} />;
}
