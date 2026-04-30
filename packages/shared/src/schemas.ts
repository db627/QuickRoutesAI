import { z } from "zod";
import { randomUUID } from "crypto";
// ── Driver Location ──
export const locationPingSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  speedMps: z.number().min(0).default(0),
  heading: z.number().min(0).max(360).default(0),
  timestamp: z.string().datetime().optional(),
});
export type LocationPingInput = z.infer<typeof locationPingSchema>;

// ── Time Window ──
export const timeWindowSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:mm format"),
  end: z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:mm format"),
});

// ── Trip Stop ──
export const tripStopSchema = z.object({
  stopId: z.string().min(1).optional(),
  address: z.string().min(1),
  contactName: z.string().default(""),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  sequence: z.number().int().min(0).optional(),
  notes: z.string().default(""),
  timeWindow: timeWindowSchema.optional(),
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
  currentLocation: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    })
    .optional(),
});
export type UpdateTripStatusInput = z.infer<typeof updateTripStatusSchema>;

// ── Update Trip ──
export const updateTripSchema = z.object({
  notes: z.string().max(1000).optional(),
  stops: z.array(tripStopSchema).optional(),
});
export type UpdateTripInput = z.infer<typeof updateTripSchema>;

// ── Reorder Stops (Manual Route Override) ──
export const reorderStopsSchema = z.object({
  stopIds: z.array(z.string().min(1)).min(2, "At least two stops are required to reorder"),
  reason: z.string().min(1, "Reason is required").max(500, "Reason must be 500 characters or fewer"),
});
export type ReorderStopsInput = z.infer<typeof reorderStopsSchema>;

// ── User Registration ──
export const userRoleSchema = z.enum(["driver", "dispatcher", "admin"]);

export const createUserProfileSchema = z.object({
  name: z.string().min(1).max(100),
  role: userRoleSchema.default("driver"),
});
export type CreateUserProfileInput = z.infer<typeof createUserProfileSchema>;

// ── Auth ──
export const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6, "Password must be at least 6 characters"),
  name: z.string().min(1).max(100),
  role: userRoleSchema.default("driver"),
  orgCode: z.string().min(1).max(128).optional(),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

// ── Update User (admin) ──
export const updateUserSchema = z.object({
  role: userRoleSchema.optional(),
  status: z.enum(["active", "deactivated"]).optional(),
  // Admin can assign a user to their own organization (`orgId: <admin's orgId>`)
  // or remove a user from the org (`orgId: null`). The route enforces that
  // admins cannot stamp some other org's id onto a user.
  orgId: z.union([z.string().min(1), z.null()]).optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

// ── Organization ──
export const orgAddressSchema = z.object({
  street: z.string().min(1).max(200),
  city: z.string().min(1).max(100),
  state: z.string().min(1).max(50),
  zip: z.string().min(1).max(20),
  country: z.string().length(2).default("US"),
});
export type OrgAddressInput = z.infer<typeof orgAddressSchema>;

export const orgBasicsSchema = z.object({
  name: z.string().min(1).max(120),
  industry: z.enum(["delivery", "logistics", "field_service", "other"]),
  fleetSize: z.enum(["1-5", "6-20", "21-50", "51-200", "200+"]),
});
export type OrgBasicsInput = z.infer<typeof orgBasicsSchema>;

export const adminProfileSchema = z.object({
  name: z.string().min(1).max(100),
  phone: z.string().min(7).max(20),
  timezone: z.string().min(1).max(64),
});
export type AdminProfileInput = z.infer<typeof adminProfileSchema>;

export const wizardProgressSchema = z.object({
  currentStep: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  data: z.object({
    orgBasics: orgBasicsSchema.optional(),
    address: orgAddressSchema.optional(),
    adminProfile: adminProfileSchema.optional(),
  }),
});
export type WizardProgressInput = z.infer<typeof wizardProgressSchema>;

export const createOrgSchema = z.object({
  orgBasics: orgBasicsSchema,
  address: orgAddressSchema,
  adminProfile: adminProfileSchema,
});
export type CreateOrgInput = z.infer<typeof createOrgSchema>;

// ── Update Organization ──
// Partial update of orgBasics fields merged with an optional address object.
export const updateOrgSchema = orgBasicsSchema
  .partial()
  .merge(z.object({ address: orgAddressSchema.optional() }))
  .refine(
    (obj) => Object.keys(obj).length > 0,
    { message: "At least one field must be provided" },
  );
export type UpdateOrgInput = z.infer<typeof updateOrgSchema>;
