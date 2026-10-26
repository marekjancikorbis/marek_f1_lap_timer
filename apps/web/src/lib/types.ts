import type { Timestamp } from 'firebase/firestore';
import type { LapProfile, StartType } from '@laptimer/timing';

/** owner: an admin who also decides admin requests (set in the database only). */
export type Role = 'driver' | 'creator' | 'admin' | 'owner';

export interface Profile {
  id: string;
  username: string;
  usernameLower: string;
  createdAt: Timestamp | null;
  /** The user's public routes; how many is limited by role (see publicLimit). */
  publicRouteIds?: string[];
  /** The public route this user calls home; they're listed as a local there. */
  homeRouteId?: string | null;
  countdownS?: number;
  acceptedTermsAt?: Timestamp | null;
  avatarHue?: number;
  /** When the notifications page was last opened; newer items light the bell. */
  notifSeenAt?: Timestamp | null;
}

export interface LngLat {
  lng: number;
  lat: number;
}

export interface Route {
  id: string;
  ownerId: string;
  ownerName: string;
  name: string;
  /** Flat [lng, lat, lng, lat, ...]: Firestore cannot store nested arrays. */
  coords: number[];
  lengthM: number;
  isLoop: boolean;
  sectorLengthM: number;
  boundaries: number[];
  startType: StartType;
  isPublic: boolean;
  publishedAt: Timestamp | null;
  hidden: boolean;
  hasRuns: boolean;
  createdAt: Timestamp | null;
  start: LngLat;
  bbox: [number, number, number, number];
  /** Published by an admin or the owner: shown as Official instead of the username. */
  official?: boolean;
  /** Waypoints the creator tapped, flat [lng, lat, ...]. */
  waypoints?: number[];
  /** Bumped on every shape change; only runs on the current shape can be posted. */
  shapeVersion?: number;
  /** Posted laps on the route, moved by one with each post or unpost (see countPost in data.ts). */
  postCount?: number;
  /** 1 once a moderator has stored the exact count; routes from before counts were kept lack it. */
  postCountV?: number;
  /** The post whose creation or deletion last moved postCount; the rules check it. */
  lastPostId?: string;
}

export interface Run {
  id: string;
  routeId: string;
  /** The route's shapeVersion when this run was driven. */
  shapeVersion?: number;
  routeName: string;
  sessionId: string;
  lap: number;
  startedAt: number;
  totalMs: number;
  splitTimesMs: number[];
  penaltyMs: number;
  jumpStart: boolean;
  jumpDistanceM: number | null;
  countdownS: number | null;
  valid: boolean;
  gpsAvgAccuracyM: number;
  gpsRateHz: number;
  /** Only on a run from getRun (it lives in the run's detail document). */
  profile?: LapProfile | null;
  /** Compact trace, 5 numbers per point: t, s, v, lat, lon. Private to the owner. Only on a run from getRun. */
  trace?: number[];
  posted: boolean;
  replay: boolean;
  /** The lap raced against, as a LapRef. */
  referenceRef?: string | null;
  createdAt: Timestamp | null;
}

export type SectorColourName = 'purple' | 'green' | 'yellow';

export interface Post {
  id: string;
  userId: string;
  username: string;
  avatarHue?: number;
  routeId: string;
  routeName: string;
  totalMs: number;
  splitTimesMs: number[];
  penaltyMs: number;
  jumpStart: boolean;
  caption: string | null;
  car: string | null;
  createdAt: Timestamp | null;
  startedAt: number;
  hidden: boolean;
  profile: LapProfile | null;
  /** Minisector colours when posted. */
  sectorColours: SectorColourName[];
  /** Big-sector colours when posted (missing on posts from before big sectors). */
  bigColours?: SectorColourName[];
  positionAtPost: number | null;
  isPB: boolean;
}

export interface CreatorRequest {
  id: string;
  username: string;
  note: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: Timestamp | null;
  decidedAt?: Timestamp | null;
}

/** Worked out on the device from follows, posts and requests; nothing stores these. */
export type Notification = { id: string; at: number } & (
  | { kind: 'follow'; userId: string; username: string; avatarHue?: number }
  | { kind: 'beaten'; post: Post; myBestMs: number }
  | { kind: 'decided'; request: 'creator' | 'admin'; approved: boolean }
  | { kind: 'request'; request: 'creator' | 'admin'; username: string }
);

export interface AuditEntry {
  id: string;
  actorId: string;
  actorName: string;
  targetUserId: string;
  targetName: string;
  action: string;
  createdAt: Timestamp | null;
}
