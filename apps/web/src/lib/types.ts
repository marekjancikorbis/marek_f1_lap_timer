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
}

export interface Run {
  id: string;
  routeId: string;
  routeName: string;
  sessionId: string;
  lap: number;
  startedAt: number;
  totalMs: number;
  splitTimesMs: number[];
  penaltyMs: number;
  reactionMs: number | null;
  jumpStart: boolean;
  jumpDistanceM: number | null;
  countdownS: number | null;
  valid: boolean;
  gpsAvgAccuracyM: number;
  gpsRateHz: number;
  profile: LapProfile | null;
  /** Compact trace, 5 numbers per point: t, s, v, lat, lon. Private to the owner. */
  trace: number[];
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
  reactionMs: number | null;
  jumpStart: boolean;
  caption: string | null;
  car: string | null;
  createdAt: Timestamp | null;
  startedAt: number;
  hidden: boolean;
  profile: LapProfile | null;
  sectorColours: SectorColourName[];
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

export interface AuditEntry {
  id: string;
  actorId: string;
  actorName: string;
  targetUserId: string;
  targetName: string;
  action: string;
  createdAt: Timestamp | null;
}
