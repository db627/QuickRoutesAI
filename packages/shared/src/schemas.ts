import { z } from "zod";

// ── Driver Location ──
export const locationPingSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  speedMps: z.number().min(0).default(0),
  heading: z.number().min(0).max(360).default(0),
  timestamp: z.string().datetime().optional(),
});
export type LocationPingInput = z.infer<typeof locationPingSchema>;

// ── Trip Stop ──
export const tripStopSchema = z.object({
  address: z.string().min(1),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  sequence: z.number().int().min(0),
  notes: z.string().default(""),
});
export type TripStopInput = z.infer<typeof tripStopSchema>;

// ── Create Trip ──
export const createTripSchema = z.object({
  stops: z.array(tripStopSchema).min(1, "At least one stop is required"),
});
export type CreateTripInput = z.infer<typeof createTripSchema>;

// ── Assign Trip ──
export const assignTripSchema = z.object({
  driverId: z.string().min(1),
});
export type AssignTripInput = z.infer<typeof assignTripSchema>;

// ── Update Trip Status ──
export const updateTripStatusSchema = z.object({
  status: z.enum(["in_progress", "completed"]),
});
export type UpdateTripStatusInput = z.infer<typeof updateTripStatusSchema>;

// ── User Registration ──
export const userRoleSchema = z.enum(["driver", "dispatcher", "admin"]);

export const createUserProfileSchema = z.object({
  name: z.string().min(1).max(100),
  role: userRoleSchema.default("driver"),
});
export type CreateUserProfileInput = z.infer<typeof createUserProfileSchema>;
