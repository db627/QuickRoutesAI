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
  orgId?: string;
  phone?: string;
  timezone?: string;
  wizardProgress?: WizardProgress;
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
  // Optional for backward compatibility with legacy documents that predate
  // org-based tenancy. New driver records are always written with orgId once
  // the driver is linked to an organization (currently only via admin signup;
  // a driver invite flow is planned as a follow-up).
  orgId?: string | null;
}

// ── Trip ──
export type TripStatus = "draft" | "assigned" | "in_progress" | "completed" | "cancelled";

export interface TimeWindow {
  start: string; // HH:mm format, e.g. "09:00"
  end: string;   // HH:mm format, e.g. "11:00"
}

export type StopStatus = "pending" | "completed";

export interface TripStop {
  stopId: string;
  address: string;
  contactName: string;
  lat: number;
  lng: number;
  sequence: number;
  notes: string;
  contact?: string;
  timeWindow?: TimeWindow;
  status?: StopStatus;
  completedAt?: string; // ISO 8601
}
export interface RouteLeg {
  fromStopId?: string;
  toStopId?: string;
  fromIndex: number;
  toIndex: number;
  distanceMeters: number;
  durationSeconds: number;         // traffic-aware
  staticDurationSeconds?: number;  // traffic-unaware
};

export interface TripRoute {
  polyline: string; // encoded polyline from Directions API
  distanceMeters: number;
  durationSeconds: number;
  createdAt: string;
  input?: TripStop[];
  naiveDistanceMeters?: number; // straight-line sum without route optimization
  fuelSavingsGallons?: number; // estimated fuel saved vs naive routing (US gallons)
  legs: RouteLeg[];
  reasoning?: string; // AI explanation of stop ordering decision
}

export interface RouteOverride {
  active: boolean;
  reason: string;
  overriddenAt: string; // ISO 8601
  overriddenBy: string; // uid
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
  orgId?: string;
  stopCount?: number;
  routeOverride?: RouteOverride;
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

// ── Organization ──
export type OrgIndustry = "delivery" | "logistics" | "field_service" | "other";
export type FleetSizeBucket = "1-5" | "6-20" | "21-50" | "51-200" | "200+";

export interface OrgAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string; // ISO-3166 alpha-2
}

export interface Org {
  id: string;
  name: string;
  industry: OrgIndustry;
  fleetSize: FleetSizeBucket;
  address: OrgAddress;
  ownerUid: string;
  createdAt: string;
  updatedAt: string;
}

// ── Wizard ──
export interface WizardProgress {
  currentStep: 1 | 2 | 3;
  data: {
    orgBasics?: { name: string; industry: OrgIndustry; fleetSize: FleetSizeBucket };
    address?: OrgAddress;
    adminProfile?: { name: string; phone: string; timezone: string };
  };
  updatedAt: string;
}
