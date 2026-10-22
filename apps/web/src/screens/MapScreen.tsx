import { collection, getCountFromServer, query, where } from 'firebase/firestore';
import type mapboxgl from 'mapbox-gl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapView } from '../components/MapView';
import { errorMessage, useToast } from '../components/ui';
import { myRoutes, publicRoutes } from '../lib/data';
import { db } from '../lib/firebase';
import { lngLatPairs } from '../lib/geo';
import { useMe } from '../lib/session';
import type { Route } from '../lib/types';

/** What a route on the map is, which sets its colour. */
type Kind = 'official' | 'creator' | 'private';

const KIND_COLOUR: Record<Kind, string> = { official: '#8b3fe0', creator: '#2f86ff', private: '#1fa64f' };
const KIND_LABEL: Record<Kind, string> = { official: 'Official', creator: 'By creators', private: 'Your private routes' };

const kindOf = (r: Route): Kind => (!r.isPublic ? 'private' : r.official ? 'official' : 'creator');

/** Mapbox expression: the colour for a feature's `kind`. */
const KIND_PAINT = ['match', ['get', 'kind'], 'official', KIND_COLOUR.official, 'creator', KIND_COLOUR.creator, KIND_COLOUR.private] as unknown as string;

export default function MapScreen() {
  const nav = useNavigate();
  const toast = useToast();
  const { profile, isCreator } = useMe();
  const [routes, setRoutes] = useState<Route[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const mapRef = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    // Public routes for everyone, plus your own private ones (only you can read those).
    Promise.all([publicRoutes(), isCreator ? myRoutes(profile.id).catch(() => []) : []])
      .then(async ([pub, mine]) => {
        const rs = [...pub, ...mine.filter((r) => !r.isPublic && !r.hidden)];
        setRoutes(rs);
        const entries = await Promise.all(
          pub.slice(0, 150).map(async (r) => {
            const c = await getCountFromServer(query(collection(db, 'posts'), where('routeId', '==', r.id), where('hidden', '==', false))).catch(() => null);
            return [r.id, c?.data().count ?? 0] as const;
          }),
        );
        setCounts(Object.fromEntries(entries));
      })
      .catch((e) => {
        toast(errorMessage(e), 'error');
        setRoutes([]);
      });
  }, [toast, isCreator, profile.id]);

  const draw = useCallback(() => {
    const map = mapRef.current;
    if (!map || !routes) return;
    const starts: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: routes.map((r) => ({
        type: 'Feature',
        properties: { id: r.id, name: r.name, laps: counts[r.id] ?? 0, kind: kindOf(r) },
        geometry: { type: 'Point', coordinates: [r.start.lng, r.start.lat] },
      })),
    };
    const lines: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: routes.map((r) => ({
        type: 'Feature',
        properties: { id: r.id, name: r.name, kind: kindOf(r) },
        geometry: { type: 'LineString', coordinates: lngLatPairs(r.coords) },
      })),
    };
    const s = map.getSource('starts') as mapboxgl.GeoJSONSource | undefined;
    if (s) {
      s.setData(starts);
      (map.getSource('lines') as mapboxgl.GeoJSONSource).setData(lines);
      return;
    }
    map.addSource('lines', { type: 'geojson', data: lines });
    map.addSource('starts', { type: 'geojson', data: starts, cluster: true, clusterRadius: 48, clusterMaxZoom: 11 });
    map.addLayer({
      id: 'lines-casing',
      type: 'line',
      source: 'lines',
      minzoom: 10,
      paint: { 'line-color': '#0c0d0e', 'line-width': 8 },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });
    map.addLayer({
      id: 'lines',
      type: 'line',
      source: 'lines',
      minzoom: 10,
      paint: { 'line-color': KIND_PAINT, 'line-width': 4.5 },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });
    map.addLayer({
      id: 'clusters',
      type: 'circle',
      source: 'starts',
      filter: ['has', 'point_count'],
      paint: {
        // Clusters mix kinds, so they stay neutral; zoom in to see colours.
        'circle-color': '#161a20',
        'circle-stroke-color': '#c9ccc8',
        'circle-stroke-width': 3,
        'circle-radius': ['step', ['get', 'point_count'], 18, 10, 24, 50, 30],
      },
    });
    map.addLayer({
      id: 'cluster-count',
      type: 'symbol',
      source: 'starts',
      filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 14, 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'] },
      paint: { 'text-color': '#eef1f5' },
    });
    // Pin size grows with the number of posted laps: busy routes read first.
    map.addLayer({
      id: 'pins',
      type: 'circle',
      source: 'starts',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': KIND_PAINT,
        'circle-stroke-color': '#eef1f5',
        'circle-stroke-width': 2.5,
        'circle-radius': ['interpolate', ['linear'], ['sqrt', ['get', 'laps']], 0, 7, 3, 11, 10, 18],
      },
    });
    map.addLayer({
      id: 'pin-labels',
      type: 'symbol',
      source: 'starts',
      filter: ['!', ['has', 'point_count']],
      minzoom: 9,
      layout: {
        'text-field': ['get', 'name'],
        'text-size': 13,
        'text-offset': [0, 1.5],
        'text-anchor': 'top',
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
      },
      paint: { 'text-color': '#eef1f5', 'text-halo-color': '#0c0e12', 'text-halo-width': 1.5 },
    });
    const open = (e: mapboxgl.MapMouseEvent & { features?: mapboxgl.MapboxGeoJSONFeature[] }) => {
      const id = e.features?.[0]?.properties?.id;
      if (id) nav(`/r/${id}`);
    };
    map.on('click', 'pins', open);
    map.on('click', 'lines', open);
    map.on('click', 'clusters', (e) => {
      const f = e.features?.[0];
      if (!f) return;
      (map.getSource('starts') as mapboxgl.GeoJSONSource).getClusterExpansionZoom(f.properties!.cluster_id, (err, zoom) => {
        if (err || zoom == null) return;
        map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom });
      });
    });
    for (const layer of ['pins', 'lines', 'clusters']) {
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
    }
    if (routes.length) {
      let w = 180, s2 = 90, e2 = -180, n = -90;
      routes.forEach((r) => {
        w = Math.min(w, r.bbox[0]);
        s2 = Math.min(s2, r.bbox[1]);
        e2 = Math.max(e2, r.bbox[2]);
        n = Math.max(n, r.bbox[3]);
      });
      map.fitBounds([w, s2, e2, n], { padding: 60, maxZoom: 13, duration: 0 });
    }
  }, [routes, counts, nav]);

  useEffect(draw, [draw]);

  const onReady = useCallback(
    (map: mapboxgl.Map) => {
      mapRef.current = map;
      draw();
      return () => {
        mapRef.current = null;
      };
    },
    [draw],
  );

  const kinds = (['official', 'creator', 'private'] as const).filter((k) => k !== 'private' || isCreator);
  const publicCount = routes?.filter((r) => r.isPublic).length ?? 0;

  return (
    <main className="map-screen">
      <MapView onReady={onReady} center={[15.5, 49.8]} zoom={6} height="100%" label="Public routes" />
      <div className="map-screen-head">
        <h1>Map</h1>
        <span className="mute">
          {routes === null ? 'Loading routes…' : `${publicCount} public ${publicCount === 1 ? 'route' : 'routes'}`}
        </span>
      </div>
      <div className="map-bottom">
        {routes && routes.length === 0 && (
          <div className="panel">
            <strong>No public routes yet</strong>
            <p className="mute">When a creator publishes a route, it appears here with its leaderboard.</p>
          </div>
        )}
        <ul className="map-legend" aria-label="Route colours">
          {kinds.map((k) => (
            <li key={k}>
              <span className="map-legend-swatch" style={{ background: KIND_COLOUR[k] }} aria-hidden="true" />
              {KIND_LABEL[k]}
            </li>
          ))}
          <li className="mute">Tap a route for details</li>
        </ul>
      </div>
    </main>
  );
}
