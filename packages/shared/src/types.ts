// ── User ──
export type UserRole = "driver" | "dispatcher" | "admin";

export interface UserProfile {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
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
export type TripStatus = "draft" | "assigned" | "in_progress" | "completed";

export interface TripStop {
  stopId: string;
  address: string;
  lat: number;
  lng: number;
  sequence: number;
  notes: string;
}

export interface TripRoute {
  polyline: string; // encoded polyline from Directions API
  distanceMeters: number;
  durationSeconds: number;
}

export interface Trip {
  id: string;
  driverId: string | null;
  createdBy: string; // dispatcher uid
  status: TripStatus;
  stops: TripStop[];
  route: TripRoute | null;
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
export interface ApiError {
  error: string;
  message: string;
}

export interface HealthResponse {
  ok: boolean;
  service: string;
}
