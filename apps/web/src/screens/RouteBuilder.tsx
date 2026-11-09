import { computeSectorBoundaries, polylineLengthM, PreparedRoute, type LatLon } from '@laptimer/timing';
import mapboxgl from 'mapbox-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { goBack } from '../lib/navStack';
import { MapView, setSource } from '../components/MapView';
import { errorMessage, I, Loading, Segmented, Sheet, useToast } from '../components/ui';
import { createRoute, getRoute, updateRoute } from '../lib/data';
import { formatDistance } from '../lib/format';
import { bboxOf, flatToLatLon, latLonToFlat, simplify } from '../lib/geo';
import { snapToRoads } from '../lib/mapbox';
import { useMe } from '../lib/session';
import type { Route } from '../lib/types';
import { UsageLimitError } from '../lib/usage';

/** Builds a new route, or edits one at /r/:routeId/edit (the rules decide who may save). */
export default function RouteBuilder() {
  const { routeId } = useParams();
  const { profile, isAdmin } = useMe();
  const nav = useNavigate();
  const [tuning, setTuning] = useState(false);
  const toast = useToast();
  const [waypoints, setWaypoints] = useState<LatLon[]>([]);
  const [snapped, setSnapped] = useState<LatLon[]>([]);
  const [loop, setLoop] = useState(false);
  const [sectorM, setSectorM] = useState(250);
  const [startType, setStartType] = useState<'standing' | 'rolling'>('rolling');
  const [name, setName] = useState('');
  const [snapping, setSnapping] = useState(false);
  const [snapError, setSnapError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markers = useRef<mapboxgl.Marker[]>([]);
  const [center, setCenter] = useState<[number, number] | null>(null);
  const [ready, setReady] = useState(false);
  const [orig, setOrig] = useState<Route | null>(null);
  // The loaded shape is already snapped; only re-snap (and so change the shape) once the user edits it.
  const skipSnap = useRef(false);
  const [shapeEdited, setShapeEdited] = useState(false);

  useEffect(() => {
    if (!routeId) return;
    getRoute(routeId).then((r) => {
      if (!r) {
        toast('Route not available', 'error');
        return nav(-1);
      }
      const pts = flatToLatLon(r.coords);
      skipSnap.current = true;
      setOrig(r);
      // shortcut: routes saved without waypoints get up to 25 sampled from the line, so editing re-snaps a close copy.
      setWaypoints(r.waypoints?.length ? flatToLatLon(r.waypoints) : pts.filter((_, i) => i % Math.ceil(pts.length / 24) === 0 || i === pts.length - 1));
      setSnapped(pts);
      setLoop(r.isLoop);
      setSectorM(r.sectorLengthM);
      setStartType(r.startType);
      setName(r.name);
      setCenter([r.start.lng, r.start.lat]);
    });
  }, [routeId, toast, nav]);

  // Start the map near the user if we can, else central Europe.
  useEffect(() => {
    if (routeId) return;
    if (!navigator.geolocation) return setCenter([16.6, 49.2]);
    navigator.geolocation.getCurrentPosition(
      (p) => setCenter([p.coords.longitude, p.coords.latitude]),
      () => setCenter([16.6, 49.2]),
      { timeout: 4000, maximumAge: 600000 },
    );
    // The timeout only starts once permission is answered; an ignored prompt would leave no map.
    const fallback = window.setTimeout(() => setCenter((c) => c ?? [16.6, 49.2]), 5000);
    return () => window.clearTimeout(fallback);
  }, [routeId]);

  const lengthM = useMemo(() => (snapped.length > 1 ? polylineLengthM(snapped) : 0), [snapped]);
  const boundaries = useMemo(() => (lengthM > 0 ? computeSectorBoundaries(lengthM, sectorM) : []), [lengthM, sectorM]);

  // Snap to roads shortly after the last edit; each request counts against the cap.
  useEffect(() => {
    if (skipSnap.current) {
      skipSnap.current = false;
      return;
    }
    if (waypoints.length < 2) {
      setSnapped(waypoints);
      return;
    }
    setShapeEdited(true);
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      setSnapping(true);
      setSnapError(null);
      try {
        setSnapped(await snapToRoads(waypoints, loop, ctrl.signal));
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        setSnapError(e instanceof UsageLimitError ? 'Monthly routing limit reached.' : errorMessage(e));
      } finally {
        setSnapping(false);
      }
    }, 650);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, [waypoints, loop]);

  // Draw line, sector ticks and the start marker.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const line: GeoJSON.Feature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: snapped.map((p) => [p.lon, p.lat]) },
    };
    setSource(map, 'route', line);
    let ticks: GeoJSON.Feature[] = [];
    if (snapped.length > 1 && boundaries.length) {
      const pr = new PreparedRoute(snapped);
      ticks = boundaries.slice(0, -1).map((b, i) => {
        const p = pr.pointAt(b);
        return { type: 'Feature', properties: { n: String(i + 1) }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } };
      });
    }
    setSource(map, 'ticks', { type: 'FeatureCollection', features: ticks });
  }, [snapped, boundaries, ready]);

  // Draggable numbered waypoint markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markers.current.forEach((m) => m.remove());
    markers.current = waypoints.map((w, i) => {
      const el = document.createElement('div');
      el.className = `wp-marker ${i === 0 ? 'start' : ''}`;
      el.textContent = i === 0 ? 'S' : String(i + 1);
      const m = new mapboxgl.Marker({ element: el, draggable: true }).setLngLat([w.lon, w.lat]).addTo(map);
      m.on('dragend', () => {
        const ll = m.getLngLat();
        setWaypoints((ws) => ws.map((x, j) => (j === i ? { lat: ll.lat, lon: ll.lng } : x)));
      });
      return m;
    });
  }, [waypoints, ready]);

  useEffect(() => {
    if (ready && orig) mapRef.current?.fitBounds(orig.bbox, { padding: 40, animate: false });
  }, [ready, orig]);

  const onReady = useCallback((map: mapboxgl.Map) => {
    mapRef.current = map;
    map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addSource('ticks', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'route-casing', type: 'line', source: 'route', paint: { 'line-color': '#0b0b0c', 'line-width': 9 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
    map.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': '#ffffff', 'line-width': 5 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
    map.addLayer({
      id: 'ticks',
      type: 'circle',
      source: 'ticks',
      paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-color': '#0b0b0c', 'circle-stroke-width': 2.5 },
    });
    map.on('click', (e) => setWaypoints((ws) => [...ws, { lat: e.lngLat.lat, lon: e.lngLat.lng }]));
    map.getCanvas().style.cursor = 'crosshair';
    setReady(true);
    return () => {
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  function locate() {
    navigator.geolocation?.getCurrentPosition(
      (p) => mapRef.current?.flyTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 15 }),
      () => toast('Location is unavailable', 'error'),
    );
  }

  const shapeChanged = !orig || shapeEdited || loop !== orig.isLoop || sectorM !== orig.sectorLengthM || startType !== orig.startType;

  async function save() {
    if (snapped.length < 2 || !name.trim()) return;
    if (orig && shapeChanged && (orig.hasRuns || orig.publishedAt)
      && !confirm('Laps timed on the old shape will no longer match. Saving deletes the laps posted on this route and your own laps on it. Continue?')) return;
    setSaving(true);
    try {
      const coords = shapeEdited || !orig ? simplify(snapped, 1.5) : snapped;
      const length = polylineLengthM(coords);
      const shape = {
        name: name.trim(),
        coords: latLonToFlat(coords),
        lengthM: Math.round(length * 10) / 10,
        isLoop: loop,
        sectorLengthM: sectorM,
        boundaries: computeSectorBoundaries(length, sectorM),
        startType,
        start: { lng: coords[0].lon, lat: coords[0].lat },
        bbox: bboxOf(coords),
        waypoints: latLonToFlat(waypoints),
      };
      let id = orig?.id;
      if (orig) await updateRoute(profile.id, orig, shapeChanged ? shape : { name: shape.name }, shapeChanged);
      else id = await createRoute({ ...shape, ownerId: profile.id, ownerName: profile.username, official: isAdmin });
      toast(orig ? 'Route updated' : 'Route saved');
      nav(`/r/${id}`, { replace: true });
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  if (routeId && !orig) return <Loading />;

  const kind = loop ? 'lap' : startType;
  const setKind = (k: 'standing' | 'rolling' | 'lap') => {
    setLoop(k === 'lap');
    setStartType(k === 'standing' ? 'standing' : 'rolling');
  };
  const km = lengthM / 1000;
  return (
    <main className="ph fixed builder">
      <div className="map">
        {center && <MapView onReady={onReady} center={center} zoom={14} height="100%" label="Route builder map. Tap to add waypoints." />}
      </div>
      <div className="edge" />
      <div className="sb" />
      <div style={{ padding: '4px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button className="glass ib" aria-label="Back" onClick={() => goBack(nav, '/routes')}>
          <I n="back" />
        </button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="glass ib" onClick={locate} aria-label="Go to my location">
            <I n="loc" />
          </button>
          <button className="glass ib" onClick={() => setWaypoints((w) => w.slice(0, -1))} disabled={!waypoints.length} aria-label="Undo last waypoint">
            <I n="undo" />
          </button>
        </div>
      </div>
      <div className="glass sheet sheet-b" style={{ paddingTop: 20, display: 'grid', gap: 10, bottom: 'calc(8px + var(--safe-b))' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }} aria-live="polite">
          <span className="t" style={{ fontSize: 40 }}>
            {km.toFixed(2)}
            <span className="lbl"> km</span>
          </span>
          <button className="lbl" onClick={() => setTuning(true)} aria-label={`${boundaries.length} sectors of ${sectorM} m. Change`}>
            {waypoints.length === 0
              ? 'Tap the map to start'
              : waypoints.length === 1
                ? 'Tap the next point'
                : snapping
                  ? 'Snapping to roads…'
                  : `${boundaries.length} sectors`}
          </button>
        </div>
        {snapError && <p className="err">{snapError}</p>}
        <label className="field">
          <span className="visually-hidden">Name</span>
          <input maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Route name" enterKeyHint="done" />
        </label>
        <Segmented
          label="Start"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'standing', label: 'Standing' },
            { value: 'rolling', label: 'Rolling' },
            { value: 'lap', label: 'Lap' },
          ]}
        />
        <button className="solid" style={{ marginTop: 4 }} disabled={saving || snapping || snapped.length < 2 || !name.trim()} onClick={save}>
          {saving ? 'Saving…' : orig ? 'Save changes' : 'Save'}
        </button>
      </div>
      <Sheet open={tuning} onClose={() => setTuning(false)} label="Sectors">
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2 className="title" style={{ fontSize: 24 }}>Sectors</h2>
            <span className="t" style={{ fontSize: 28 }}>{sectorM} m</span>
          </div>
          <input className="range" type="range" min={50} max={1000} step={50} value={sectorM} onChange={(e) => setSectorM(Number(e.target.value))} aria-label="Sector length" />
          <p className="lbl" style={{ fontSize: 14 }}>
            The ticks on the map show where each sector ends. A short last sector merges into the one before.{' '}
            {startType === 'rolling' ? 'The timer starts when you cross the start line.' : 'Standing: stop at the start, then a 3–10 s countdown; moving more than 10 m early costs +5 s.'}
          </p>
          <p className="lbl" style={{ fontSize: 14 }}>
            {orig
              ? 'Changing the shape, sectors or start resets the laps timed on this route.'
              : 'New routes are private. Once a route has been published, its shape and sectors are locked.'}
          </p>
          <button
            className="solid danger"
            disabled={!waypoints.length}
            onClick={() => {
              setWaypoints([]);
              setTuning(false);
            }}
          >
            Clear the route
          </button>
          <button className="solid quiet" onClick={() => setTuning(false)}>
            Done
          </button>
        </div>
      </Sheet>
    </main>
  );
}
