import { collection, getCountFromServer, query, where } from 'firebase/firestore';
import { Search as SearchIcon, X } from 'lucide-react';
import type mapboxgl from 'mapbox-gl';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FollowButton } from '../components/FollowButton';
import { MapView } from '../components/MapView';
import { RouteShape } from '../components/RouteShape';
import { Avatar, errorMessage, Spinner, useToast, WhoText } from '../components/ui';
import { myRoutes, publicRoutes, searchUsers, setPostCount } from '../lib/data';
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

/** Where the map was last left (per device), so the next visit opens there without a jump. */
const CAMERA_KEY = 'explore-camera';
function savedCamera(): { center: [number, number]; zoom: number } | null {
  try {
    return JSON.parse(localStorage.getItem(CAMERA_KEY) ?? 'null');
  } catch {
    return null;
  }
}

/** Explore: the map of routes with one search for routes and drivers. */
export default function MapScreen() {
  const nav = useNavigate();
  const toast = useToast();
  const { profile, isCreator, isAdmin } = useMe();
  const [routes, setRoutes] = useState<Route[] | null>(null);
  /** Counted here for routes from before counts were kept on the route. */
  const [oldCounts, setOldCounts] = useState<Record<string, number>>({});
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [camera] = useState(savedCamera);
  const [mapReady, setMapReady] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [q, setQ] = useState(() => sessionStorage.getItem('explore-q') ?? '');
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState(false);
  // While typing, the results sit under the search instead of behind the keyboard.
  const [docked, setDocked] = useState(false);
  const [dock, setDock] = useState({ top: 0, h: 0 });
  const topRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const drag = useRef<{ y: number; h: number; dy: number } | null>(null);
  const dragged = useRef(false);
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

  // The map's tiles get the network first; routes load once it has drawn (or after a few
  // seconds, if the map can't load), then go on top.
  const [routesDue, setRoutesDue] = useState(false);
  useEffect(() => {
    if (mapReady) setRoutesDue(true);
    const t = window.setTimeout(() => setRoutesDue(true), 4000);
    return () => window.clearTimeout(t);
  }, [mapReady]);

  useEffect(() => {
    if (!routesDue) return;
    // Public routes for everyone, plus your own private ones (only you can read those).
    Promise.all([publicRoutes(), isCreator ? myRoutes(profile.id).catch(() => []) : []])
      .then(async ([pub, mine]) => {
        setRoutes([...pub, ...mine.filter((r) => !r.isPublic && !r.hidden)]);
        // Routes from before counts were kept: count them once here; a moderator's visit stores it.
        // shortcut: a post landing between this count and the store is missed until the next recount.
        const old = pub.filter((r) => r.postCountV !== 1).slice(0, 150);
        const entries = await Promise.all(
          old.map(async (r) => {
            const c = await getCountFromServer(query(collection(db, 'posts'), where('routeId', '==', r.id), where('hidden', '==', false))).catch(() => null);
            if (c && isAdmin) void setPostCount(r.id, c.data().count).catch(() => undefined);
            return [r.id, c?.data().count ?? 0] as const;
          }),
        );
        if (entries.length) setOldCounts(Object.fromEntries(entries));
      })
      .catch((e) => {
        toast(errorMessage(e), 'error');
        setRoutes([]);
      });
  }, [routesDue, toast, isCreator, isAdmin, profile.id]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of routes ?? []) c[r.id] = r.postCountV === 1 ? Math.max(0, r.postCount ?? 0) : (oldCounts[r.id] ?? Math.max(0, r.postCount ?? 0));
    return c;
  }, [routes, oldCounts]);

  /** The routes the map was last fitted to: counts arriving must not move the map. */
  const fitted = useRef<string | null>(null);

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
    // Fit when the set of routes changes (a chip, a search), not when only counts change.
    // The first time, a saved view stays put: it's where the driver left the map.
    const key = routes.map((r) => r.id).join();
    const refit = () => {
      if (fitted.current !== key && (fitted.current !== null || !camera)) fit(map, routes);
      fitted.current = key;
    };
    const s = map.getSource('starts') as mapboxgl.GeoJSONSource | undefined;
    if (s) {
      s.setData(starts);
      (map.getSource('lines') as mapboxgl.GeoJSONSource).setData(lines);
      refit();
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
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 14, 'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'] },
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
    refit();
  }, [shown, counts, nav, camera]);

  useEffect(draw, [draw]);

  // The space left between the search and the keyboard.
  useEffect(() => {
    if (!docked) return;
    const vv = window.visualViewport;
    const fit = () => {
      const el = topRef.current;
      const top = el ? el.offsetTop + el.offsetHeight + 8 : 0;
      setDock({ top, h: Math.max(120, (vv ? vv.height + vv.offsetTop : window.innerHeight) - top - 8) });
    };
    fit();
    vv?.addEventListener('resize', fit);
    vv?.addEventListener('scroll', fit);
    return () => {
      vv?.removeEventListener('resize', fit);
      vv?.removeEventListener('scroll', fit);
    };
  }, [docked]);

  // The pull tab: the sheet follows the finger, then snaps open or shut by the drag's direction.
  const onPull = (e: PointerEvent<HTMLButtonElement>) => {
    if (docked) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, h: sheetRef.current!.offsetHeight, dy: 0 };
  };
  // The sheet's height follows the finger. While dragging it holds the whole list, so pulling
  // up shows more rows at once (collapsed, it only has two, and couldn't grow past them).
  const onPullMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    const sheet = sheetRef.current;
    if (!d || !sheet) return;
    d.dy = e.clientY - d.y;
    if (Math.abs(d.dy) < 5) return;
    setDragging(true);
    sheet.style.transition = 'none';
    sheet.style.maxHeight = 'none';
    sheet.style.height = `${Math.min(sheet.parentElement!.clientHeight * 0.85, Math.max(70, d.h - d.dy))}px`;
  };
  const onPullEnd = () => {
    const d = drag.current;
    const sheet = sheetRef.current;
    drag.current = null;
    if (!d || !sheet || Math.abs(d.dy) < 5) return;
    dragged.current = true;
    // Hand over to the open or shut height from where the finger let go, animated.
    sheet.style.maxHeight = `${sheet.offsetHeight}px`;
    sheet.style.height = '';
    void sheet.offsetHeight;
    sheet.style.transition = '';
    sheet.style.maxHeight = '';
    setDragging(false);
    setOpen(d.dy < 0);
  };

  const onReady = useCallback(
    (map: mapboxgl.Map) => {
      mapRef.current = map;
      setMapReady(true);
      draw();
      const keep = () => {
        try {
          const c = map.getCenter();
          localStorage.setItem(CAMERA_KEY, JSON.stringify({ center: [c.lng, c.lat], zoom: map.getZoom() }));
        } catch {
          // Private mode or storage full: the next visit just starts on the whole country.
        }
      };
      map.on('moveend', keep);
      return () => {
        map.off('moveend', keep);
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
  const expanded = open || docked || dragging;
  const title =
    filter === 'drivers'
      ? 'Drivers'
      : routes === null
        ? 'Loading routes…'
        : `${filter === 'private' ? 'Your routes' : term ? 'Matching routes' : 'Public routes'} · ${listed.length}`;

  return (
    <main className="map-screen">
      <MapView onReady={onReady} center={camera?.center ?? [15.5, 49.8]} zoom={camera?.zoom ?? 6} height="100%" label="Routes" />
      <div className="explore-top" ref={topRef}>
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
            onChange={(e) => {
              setQ(e.target.value);
              if (e.target.value) setOpen(true);
            }}
            onFocus={() => setDocked(true)}
            onBlur={() => setDocked(false)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
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
            <button key={f} className="chip" aria-pressed={filter === f} onClick={() => {
                setFilter(f);
                if (f === 'drivers') setOpen(true);
              }}>
              {FILTER_LABEL[f]}
            </button>
          ))}
        </div>
      </div>

      <section
        ref={sheetRef}
        className={`explore-sheet ${expanded ? 'open' : ''} ${docked ? 'docked' : ''}`}
        style={docked ? { top: dock.top, maxHeight: dock.h } : undefined}
        aria-label="Results"
        // Keeps the search focused (and the list in place) when a result is tapped.
        onMouseDown={(e) => docked && e.preventDefault()}
      >
        <button
          className="explore-sheet-head"
          aria-expanded={expanded}
          onClick={() => {
            if (dragged.current) dragged.current = false;
            else if (!docked) setOpen((o) => !o);
          }}
          onPointerDown={onPull}
          onPointerMove={onPullMove}
          onPointerUp={onPullEnd}
          onPointerCancel={onPullEnd}
        >
          {!docked && <span className="grabber" aria-hidden="true" />}
          <strong className="explore-sheet-title">{title}</strong>
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
                <p className="mute explore-empty">Type the start of a name or @username to find a driver.</p>
              ) : drivers && drivers.length === 0 && !searching ? (
                <p className="mute explore-empty">No driver's name or @username starts with “{q.trim().replace(/^@/, '')}”.</p>
              ) : (
                <ul className="explore-list">
                  {(drivers ?? []).map((p) => (
                    <li key={p.id} className="explore-row">
                      <Link to={`/u/${p.username}`} className="row grow" style={{ gap: 12, textDecoration: 'none' }}>
                        <Avatar name={p.username} hue={p.avatarHue} size={36} uid={p.id} />
                        <WhoText p={p} />
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
