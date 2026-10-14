/** 1:42.310 / 42.310 */
export function formatLap(ms: number | null | undefined): string {
  if (ms == null || !isFinite(ms)) return '–:––.–––';
  const neg = ms < 0;
  const abs = Math.abs(Math.round(ms));
  const m = Math.floor(abs / 60000);
  const s = Math.floor((abs % 60000) / 1000);
  const milli = String(abs % 1000).padStart(3, '0');
  const body = m > 0 ? `${m}:${String(s).padStart(2, '0')}.${milli}` : `${s}.${milli}`;
  return neg ? `−${body}` : body;
}

/** Signed delta: −0.42 / +1.07 */
export function formatDelta(ms: number | null | undefined, decimals = 2): string {
  if (ms == null || !isFinite(ms)) return '±0.00';
  const v = (Math.abs(ms) / 1000).toFixed(decimals);
  const sign = ms < 0 ? '−' : ms > 0 ? '+' : '±';
  return `${sign}${v}`;
}

export function formatSeconds(ms: number, decimals = 1): string {
  const sign = ms < 0 ? '−' : '';
  return `${sign}${(Math.abs(ms) / 1000).toFixed(decimals)} s`;
}

export function formatDistance(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(m >= 10000 ? 1 : 2)} km`;
  return `${Math.round(m)} m`;
}

/** m/s to whole km/h */
export function formatSpeed(ms: number | null | undefined): string {
  if (ms == null || !isFinite(ms)) return '–';
  return `${Math.round(ms * 3.6)}`;
}

export function timeAgo(date: Date | null | undefined, now = new Date()): string {
  if (!date) return 'just now';
  const s = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} d ago`;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d > 300 ? 'numeric' : undefined });
}

export function formatDate(date: Date | number | null | undefined): string {
  if (date == null) return '';
  const d = typeof date === 'number' ? new Date(date) : date;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Who a route is credited to: Official for admin and owner routes, else the creator's username. */
export function routeAuthor(route: { official?: boolean; ownerName: string }): string {
  return route.official ? 'Official' : route.ownerName;
}

export const ROLE_LABEL: Record<'creator' | 'admin' | 'owner', string> = { creator: 'Creator', admin: 'Admin', owner: 'Owner' };
