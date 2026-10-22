import { collection, getCountFromServer, query, where } from 'firebase/firestore';
import { ChevronDown, ChevronUp, Search as SearchIcon, X } from 'lucide-react';
import type mapboxgl from 'mapbox-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FollowButton } from '../components/FollowButton';
import { MapView } from '../components/MapView';
import { RouteShape } from '../components/RouteShape';
import { Avatar, errorMessage, Spinner, useToast } from '../components/ui';
import { myRoutes, publicRoutes, searchUsers } from '../lib/data';
import { db } from '../lib/firebase';
import { formatDistance } from '../lib/format';
import { lngLatPairs } from '../lib/geo';
import { useMe } from '../lib/session';
import type { Profile, Route } from '../lib/types';

/** What a route on the map is, which sets its colour. */
type Kind = 'official' | 'creator' | 'private';

const KIND_COLOUR: Record<Kind, string> = { official: '#8b3fe0', creator: '#2f86ff', private: '#1fa64f' };
type Filter = 'all' | Kind | 'drivers';
const FILTER_LABEL: Record<Filter, string> = { all: 'All routes', official: 'Official', creator: 'Creators', private: 'Mine', drivers: 'Drivers' };

const kindOf = (r: Route): Kind => (!r.isPublic ? 'private' : r.official ? 'official' : 'creator');

/** Mapbox expression: the colour for a feature's `kind`. */
const KIND_PAINT = ['match', ['get', 'kind'], 'official', KIND_COLOUR.official, 'creator', KIND_COLOUR.creator, KIND_COLOUR.private] as unknown as string;

/** Explore: the map of routes with one search for routes and drivers. */
export default function MapScreen() {
  const nav = useNavigate();
  const toast = useToast();
  const { profile, isCreator } = useMe();
  const [routes, setRoutes] = useState<Route[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [q, setQ] = useState(() => sessionStorage.getItem('explore-q') ?? '');
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState(false);
  const [drivers, setDrivers] = useState<Profile[] | null>(null);
  const [searching, setSearching] = useState(false);
  const term = q.trim().toLowerCase();

  // Drivers by username prefix, debounced.
  useEffect(() => {
    sessionStorage.setItem('explore-q', q);
    if (!term) {
      setDrivers(null);
      return;
    }
    setSearching(true);
    const t = window.setTimeout(() => {
      searchUsers(term)
        .then(setDrivers)
        .catch((e) => toast(errorMessage(e), 'error'))
        .finally(() => setSearching(false));
    }, 220);
    return () => window.clearTimeout(t);
  }, [term, q, toast]);

  // What the map and list show: the chip, then the search text.
  const shown = useMemo(() => {
    if (!routes) return null;
    const byKind = filter === 'all' || filter === 'drivers' ? routes : routes.filter((r) => kindOf(r) === filter);
    return term ? byKind.filter((r) => r.name.toLowerCase().includes(term)) : byKind;
  }, [routes, filter, term]);

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
    const routes = shown;
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
      fit(map, routes);
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
        'circle-stroke-color': '#c3c9d2',
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
    fit(map, routes);
  }, [shown, counts, nav]);

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

  const listed = (shown ?? [])
    .filter((r) => r.isPublic || filter === 'private')
    .sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0) || a.name.localeCompare(b.name));
  const filters: Filter[] = ['all', 'official', 'creator', ...(isCreator ? (['private'] as const) : []), 'drivers'];
  const showDrivers = filter === 'drivers' || (!!term && filter === 'all');
  const showRoutes = filter !== 'drivers';
  // Collapsed, the sheet shows a couple of rows; searching opens it.
  const expanded = open || !!term || filter === 'drivers';
  const title =
    filter === 'drivers'
      ? 'Drivers'
      : routes === null
        ? 'Loading routes…'
        : `${filter === 'private' ? 'Your routes' : term ? 'Matching routes' : 'Public routes'} · ${listed.length}`;

  return (
    <main className="map-screen">
      <MapView onReady={onReady} center={[15.5, 49.8]} zoom={6} height="100%" label="Routes" />
      <div className="explore-top">
        <label className="search-box explore-search">
          <SearchIcon size={18} aria-hidden="true" />
          <span className="visually-hidden">Search routes and drivers</span>
          <input
            className="input"
            type="search"
            placeholder="Search routes and drivers"
            value={q}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setQ(e.target.value)}
          />
          {searching ? (
            <Spinner label="Searching" />
          ) : (
            q && (
              <button className="icon-btn explore-clear" aria-label="Clear search" onClick={() => setQ('')}>
                <X size={18} />
              </button>
            )
          )}
        </label>
        <div className="chips" role="group" aria-label="Show">
          {filters.map((f) => (
            <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {FILTER_LABEL[f]}
            </button>
          ))}
        </div>
      </div>

      <section className={`explore-sheet ${expanded ? 'open' : ''}`} aria-label="Results">
        <button className="explore-sheet-head" onClick={() => setOpen((o) => !o)} aria-expanded={expanded}>
          <span className="grabber" aria-hidden="true" />
          <span className="row between" style={{ width: '100%' }}>
            <strong className="explore-sheet-title">{title}</strong>
            {showRoutes && !term && (
              <span className="mute small-text row">
                Most driven {expanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronUp size={16} aria-hidden="true" />}
              </span>
            )}
          </span>
        </button>
        <div className="explore-sheet-body">
          {showRoutes &&
            (routes && listed.length === 0 ? (
              <p className="mute explore-empty">
                {term
                  ? `No route name contains “${q.trim()}”.`
                  : filter === 'private'
                    ? 'You have no private routes.'
                    : 'No public routes yet. When a creator publishes one, it shows up here with its leaderboard.'}
              </p>
            ) : (
              <ul className="explore-list">
                {(expanded ? listed : listed.slice(0, 2)).map((r) => (
                  <li key={r.id}>
                    <Link to={`/r/${r.id}`} className="explore-row">
                      <span className="explore-shape" aria-hidden="true">
                        <RouteShape route={r} height={40} ticks={false} />
                      </span>
                      <span className="grow">
                        <strong className="ellipsis">{r.name}</strong>
                        <span className="mute ellipsis small-text">
                          {r.official ? 'Official' : r.isPublic ? `by ${r.ownerName}` : 'Private'} · {formatDistance(r.lengthM)}
                        </span>
                      </span>
                      {r.isPublic && (
                        <span className="explore-laps">
                          <strong className="num">{counts[r.id] ?? '–'}</strong>
                          <span className="mute small-text">{counts[r.id] === 1 ? 'lap' : 'laps'}</span>
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            ))}
          {showDrivers && (
            <>
              {filter === 'all' && <h2 className="section-title">Drivers</h2>}
              {!term ? (
                <p className="mute explore-empty">Type the start of a username to find a driver.</p>
              ) : drivers && drivers.length === 0 && !searching ? (
                <p className="mute explore-empty">Nobody's username starts with “{q.trim()}”.</p>
              ) : (
                <ul className="explore-list">
                  {(drivers ?? []).map((p) => (
                    <li key={p.id} className="explore-row">
                      <Link to={`/u/${p.username}`} className="row grow" style={{ gap: 12, textDecoration: 'none' }}>
                        <Avatar name={p.username} hue={p.avatarHue} size={36} />
                        <strong className="grow ellipsis">{p.username}</strong>
                      </Link>
                      <FollowButton userId={p.id} />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </section>
    </main>
  );
}

function fit(map: mapboxgl.Map, routes: Route[]) {
  if (!routes.length) return;
  let w = 180, s = 90, e = -180, n = -90;
  routes.forEach((r) => {
    w = Math.min(w, r.bbox[0]);
    s = Math.min(s, r.bbox[1]);
    e = Math.max(e, r.bbox[2]);
    n = Math.max(n, r.bbox[3]);
  });
  // Leave room for the search on top and the results sheet below.
  map.fitBounds([w, s, e, n], { padding: { top: 140, bottom: 200, left: 40, right: 40 }, maxZoom: 13, duration: 0 });
}
