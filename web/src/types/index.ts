import type { InferSelectModel } from 'drizzle-orm';
import type {
  chargers,
  sessions,
  reservations,
  strikes,
  suspensions,
  config,
} from '@/lib/db/schema';

/** Row types inferred from the Drizzle schema */
export type Charger = InferSelectModel<typeof chargers>;
export type Session = InferSelectModel<typeof sessions>;
export type Reservation = InferSelectModel<typeof reservations>;
export type Strike = InferSelectModel<typeof strikes>;
export type Suspension = InferSelectModel<typeof suspensions>;
export type ConfigRow = InferSelectModel<typeof config>;

/** Auth context passed through request handlers */
export interface Auth {
  email: string;
  name: string;
  isAdmin: boolean;
  suspension?: SerializedSuspension | null;
  isNetNew?: boolean;
  isReturning?: boolean;
}

/** Serialized suspension for client transport */
export interface SerializedSuspension {
  startAt: string;
  endAt: string;
  reason: string;
}

/** Serialized session for client transport */
export interface SerializedSession {
  sessionId: string;
  chargerId: string;
  userEmail: string;
  userName: string;
  startTime: string;
  endTime: string;
  status: string;
  overdue: boolean;
}

/** Serialized reservation for client transport */
export interface SerializedReservation {
  reservationId: string;
  chargerId: string;
  userEmail: string;
  userName: string;
  startTime: string;
  endTime: string;
  status: string;
  checkedInAt: string;
  noShowAt: string;
}

/** Slot time window */
export interface Slot {
  startTime: Date;
  endTime: Date;
}

/** Walk-up window info for a charger slot */
export interface WalkupInfo {
  startTime: string;
  endTime: string;
  openAt: string;
  allUsersOpenAt: string;
  returningUsersOpenAt: string;
  isOpen: boolean;
  isOpenToReturning: boolean;
  isOpenToAll: boolean;
}

/** Charger view as returned by buildBoard */
export interface ChargerView {
  id: string;
  name: string;
  maxMinutes: number;
  status: string;
  statusKey: string;
  session: SerializedSession | null;
  reservation: SerializedReservation | null;
  nextReservation: SerializedReservation | null;
  walkup: WalkupInfo | null;
}

/** Full board response sent to the client */
export interface BoardData {
  user: Auth;
  chargers: ChargerView[];
  reservations: SerializedReservation[];
  serverTime: string;
  timezone: string;
  config: Record<string, unknown>;
}
