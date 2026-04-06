// ── User ──
export type UserRole = "driver" | "dispatcher" | "admin";
export type UserStatus = "active" | "deactivated";

export interface UserProfile {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  status?: UserStatus; // omitted on legacy documents — treat as "active"
  createdAt: string; // ISO 8601
}

// ── Driver ──
export interface DriverLocation {
  lat: number;
  lng: number;
}

export interface DriverRecord {
  uid: string;
  isOnline: boolean;
  lastLocation: DriverLocation | null;
  lastSpeedMps: number;
  lastHeading: number;
  updatedAt: string;
}

// ── Trip ──
export type TripStatus = "draft" | "assigned" | "in_progress" | "completed" | "cancelled";

export interface TimeWindow {
  start: string; // HH:mm format, e.g. "09:00"
  end: string;   // HH:mm format, e.g. "11:00"
}

export interface TripStop {
  stopId: string;
  address: string;
  lat: number;
  lng: number;
  sequence: number;
  notes: string;
  timeWindow?: TimeWindow;
}

export interface TripRoute {
  polyline: string; // encoded polyline from Directions API
  distanceMeters: number;
  durationSeconds: number;
  naiveDistanceMeters?: number; // straight-line sum without route optimization
  fuelSavingsGallons?: number; // estimated fuel saved vs naive routing (US gallons)
}

export interface Trip {
  id: string;
  driverId: string | null;
  createdBy: string; // dispatcher uid
  status: TripStatus;
  stops: TripStop[];
  route: TripRoute | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Event ──
export type EventType = "location_ping" | "status_change";

export interface DriverEvent {
  id: string;
  type: EventType;
  driverId: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

// ── API Responses ──
import type { ErrorCode } from "./errors";

export interface ApiError {
  error: ErrorCode;
  message: string;
  details?: { path: string; message: string }[];
}

export interface HealthResponse {
  ok: boolean;
  service: string;
}
