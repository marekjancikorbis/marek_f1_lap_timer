import { computeSectorBoundaries, polylineLengthM, PreparedRoute, type LatLon } from '@laptimer/timing';
import mapboxgl from 'mapbox-gl';
import { Crosshair, Trash2, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { MapView, setSource } from '../components/MapView';
import { errorMessage, Loading, ScreenHead, Segmented, Switch, useToast } from '../components/ui';
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
  const { profile, isCreator, isAdmin } = useMe();
  const nav = useNavigate();
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
    map.addLayer({ id: 'route-casing', type: 'line', source: 'route', paint: { 'line-color': '#0c0d0e', 'line-width': 9 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
    map.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': '#2f86ff', 'line-width': 5 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
    map.addLayer({
      id: 'ticks',
      type: 'circle',
      source: 'ticks',
      paint: { 'circle-radius': 6, 'circle-color': '#0c0d0e', 'circle-stroke-color': '#eef1f5', 'circle-stroke-width': 2.5 },
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

  if (!isCreator) return <Navigate to="/times" replace />;
  if (routeId && !orig) return <Loading />;

  return (
    <main className="screen builder">
      <ScreenHead back title={orig ? 'Edit route' : 'New route'} />
      <div className="builder-map">
        {center && <MapView onReady={onReady} center={center} zoom={14} height="100%" label="Route builder map. Tap to add waypoints." />}
        <div className="builder-tools">
          <button className="icon-btn map-btn" onClick={locate} aria-label="Go to my location">
            <Crosshair size={20} />
          </button>
          <button className="icon-btn map-btn" onClick={() => setWaypoints((w) => w.slice(0, -1))} disabled={!waypoints.length} aria-label="Undo last waypoint">
            <Undo2 size={20} />
          </button>
          <button className="icon-btn map-btn" onClick={() => setWaypoints([])} disabled={!waypoints.length} aria-label="Clear all waypoints">
            <Trash2 size={20} />
          </button>
        </div>
        <div className="builder-status" aria-live="polite">
          {waypoints.length === 0
            ? 'Tap the map to place the start'
            : waypoints.length === 1
              ? 'Tap to add the next point'
              : snapping
                ? 'Snapping to roads…'
                : `${formatDistance(lengthM)} · ${boundaries.length} sectors`}
        </div>
      </div>
      {snapError && <p className="notice error" style={{ marginTop: 12 }}>{snapError}</p>}

      <div className="stack" style={{ marginTop: 16 }}>
        <div className="panel row between">
          <span>
            <strong>Lap (loop)</strong>
            <span className="mute" style={{ display: 'block', fontSize: 13 }}>
              Finish where you start; laps run back to back
            </span>
          </span>
          <Switch label="Loop route" checked={loop} onChange={setLoop} />
        </div>

        <div className="panel stack">
          <label className="field">
            <span>
              Sector length: <strong className="num" style={{ fontSize: 18 }}>{sectorM} m</strong>
            </span>
            <input type="range" min={50} max={1000} step={50} value={sectorM} onChange={(e) => setSectorM(Number(e.target.value))} />
          </label>
          <small className="mute">The white ticks on the map show where each sector ends. A short last sector merges into the one before.</small>
        </div>

        <div className="panel stack">
          <span style={{ fontWeight: 500 }}>Start</span>
          <Segmented
            label="Start type"
            value={startType}
            onChange={setStartType}
            options={[
              { value: 'rolling', label: 'Rolling' },
              { value: 'standing', label: 'Standing' },
            ]}
          />
          <small className="mute">
            {startType === 'rolling'
              ? 'The timer starts when you cross the start line.'
              : 'Stop at the start, then a 3–10 s countdown. Moving more than 10 m early costs +5 s.'}
          </small>
        </div>

        <label className="field">
          <span>Name</span>
          <input className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Brno Circuit, full lap" />
        </label>

        <button className="btn primary lg block" disabled={saving || snapping || snapped.length < 2 || !name.trim()} onClick={save}>
          {saving ? 'Saving…' : orig ? 'Save changes' : 'Save route'}
        </button>
        <p className="mute" style={{ fontSize: 13, textAlign: 'center' }}>
          {orig
            ? 'Changing the shape, sectors or start resets the laps timed on this route.'
            : 'New routes are private. Once a route has been published, its shape and sectors are locked.'}
        </p>
      </div>
    </main>
  );
}
