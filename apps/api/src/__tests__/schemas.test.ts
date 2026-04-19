import {
  locationPingSchema,
  createTripSchema,
  assignTripSchema,
  updateTripStatusSchema,
  createUserProfileSchema,
} from "@quickroutesai/shared";

describe("locationPingSchema", () => {
  it("validates a correct location ping", () => {
    const result = locationPingSchema.safeParse({
      lat: 40.7128,
      lng: -74.006,
      speedMps: 15.5,
      heading: 270,
    });
    expect(result.success).toBe(true);
  });

  it("rejects lat out of range", () => {
    const result = locationPingSchema.safeParse({ lat: 91, lng: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects lng out of range", () => {
    const result = locationPingSchema.safeParse({ lat: 0, lng: 181 });
    expect(result.success).toBe(false);
  });

  it("defaults speedMps and heading to 0", () => {
    const result = locationPingSchema.parse({ lat: 0, lng: 0 });
    expect(result.speedMps).toBe(0);
    expect(result.heading).toBe(0);
  });
});

describe("createTripSchema", () => {
  it("validates trip with stops", () => {
    const result = createTripSchema.safeParse({
      stops: [
        { address: "123 Main St", lat: 40.7, lng: -74.0, sequence: 0 },
        { address: "456 Oak Ave", lat: 40.8, lng: -73.9, sequence: 1 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty stops array", () => {
    const result = createTripSchema.safeParse({ stops: [] });
    expect(result.success).toBe(false);
  });

  it("rejects stop with missing address", () => {
    const result = createTripSchema.safeParse({
      stops: [{ lat: 40.7, lng: -74.0, sequence: 0 }],
    });
    expect(result.success).toBe(false);
  });

  it("defaults notes to empty string", () => {
    const result = createTripSchema.parse({
      stops: [{ address: "Test", lat: 0, lng: 0, sequence: 0 }],
    });
    expect(result.stops[0].notes).toBe("");
  });
});

describe("assignTripSchema", () => {
  it("validates with driverId", () => {
    const result = assignTripSchema.safeParse({ driverId: "abc123" });
    expect(result.success).toBe(true);
  });

  it("rejects empty driverId", () => {
    const result = assignTripSchema.safeParse({ driverId: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing driverId", () => {
    const result = assignTripSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("updateTripStatusSchema", () => {
  it("accepts in_progress", () => {
    expect(updateTripStatusSchema.safeParse({ status: "in_progress" }).success).toBe(true);
  });

  it("accepts completed", () => {
    expect(updateTripStatusSchema.safeParse({ status: "completed" }).success).toBe(true);
  });

  it("rejects draft (drivers cannot set back to draft)", () => {
    expect(updateTripStatusSchema.safeParse({ status: "draft" }).success).toBe(false);
  });

  it("rejects arbitrary strings", () => {
    expect(updateTripStatusSchema.safeParse({ status: "cancelled" }).success).toBe(false);
  });

  it("accepts optional currentLocation", () => {
    expect(
      updateTripStatusSchema.safeParse({
        status: "in_progress",
        currentLocation: { lat: 40.7357, lng: -74.1724 },
      }).success,
    ).toBe(true);
  });

  it("rejects invalid currentLocation coordinates", () => {
    expect(
      updateTripStatusSchema.safeParse({
        status: "in_progress",
        currentLocation: { lat: 140.7357, lng: -74.1724 },
      }).success,
    ).toBe(false);
  });
});

describe("createUserProfileSchema", () => {
  it("validates with name and role", () => {
    const result = createUserProfileSchema.safeParse({ name: "John", role: "dispatcher" });
    expect(result.success).toBe(true);
  });

  it("defaults role to driver", () => {
    const result = createUserProfileSchema.parse({ name: "Jane" });
    expect(result.role).toBe("driver");
  });

  it("rejects empty name", () => {
    expect(createUserProfileSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("rejects invalid role", () => {
    expect(createUserProfileSchema.safeParse({ name: "Test", role: "superadmin" }).success).toBe(false);
  });
});

import {
  orgAddressSchema,
  orgBasicsSchema,
  adminProfileSchema,
  wizardProgressSchema,
  createOrgSchema,
} from "@quickroutesai/shared";

describe("orgAddressSchema", () => {
  it("accepts a valid address", () => {
    const r = orgAddressSchema.safeParse({
      street: "1 Main St",
      city: "Boston",
      state: "MA",
      zip: "02101",
      country: "US",
    });
    expect(r.success).toBe(true);
  });

  it("defaults country to US", () => {
    const r = orgAddressSchema.safeParse({
      street: "1 Main St",
      city: "Boston",
      state: "MA",
      zip: "02101",
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.country).toBe("US");
  });

  it("rejects empty street", () => {
    const r = orgAddressSchema.safeParse({
      street: "",
      city: "Boston",
      state: "MA",
      zip: "02101",
    });
    expect(r.success).toBe(false);
  });
});

describe("orgBasicsSchema", () => {
  it("accepts a valid payload", () => {
    const r = orgBasicsSchema.safeParse({
      name: "Acme Delivery",
      industry: "delivery",
      fleetSize: "6-20",
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown industry", () => {
    const r = orgBasicsSchema.safeParse({
      name: "Acme",
      industry: "banking",
      fleetSize: "6-20",
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown fleetSize bucket", () => {
    const r = orgBasicsSchema.safeParse({
      name: "Acme",
      industry: "delivery",
      fleetSize: "1000",
    });
    expect(r.success).toBe(false);
  });
});

describe("adminProfileSchema", () => {
  it("accepts a valid profile", () => {
    const r = adminProfileSchema.safeParse({
      name: "Alice",
      phone: "555-1234",
      timezone: "America/New_York",
    });
    expect(r.success).toBe(true);
  });

  it("rejects short phone", () => {
    const r = adminProfileSchema.safeParse({
      name: "Alice",
      phone: "12",
      timezone: "America/New_York",
    });
    expect(r.success).toBe(false);
  });
});

describe("wizardProgressSchema", () => {
  it("accepts step 1 with only orgBasics", () => {
    const r = wizardProgressSchema.safeParse({
      currentStep: 1,
      data: {
        orgBasics: { name: "Acme", industry: "delivery", fleetSize: "1-5" },
      },
    });
    expect(r.success).toBe(true);
  });

  it("rejects currentStep out of range", () => {
    const r = wizardProgressSchema.safeParse({
      currentStep: 4,
      data: {},
    });
    expect(r.success).toBe(false);
  });
});

describe("createOrgSchema", () => {
  it("accepts a complete payload", () => {
    const r = createOrgSchema.safeParse({
      orgBasics: { name: "Acme", industry: "delivery", fleetSize: "1-5" },
      address: {
        street: "1 Main St",
        city: "Boston",
        state: "MA",
        zip: "02101",
        country: "US",
      },
      adminProfile: {
        name: "Alice",
        phone: "555-1234",
        timezone: "America/New_York",
      },
    });
    expect(r.success).toBe(true);
  });

  it("rejects when address is missing", () => {
    const r = createOrgSchema.safeParse({
      orgBasics: { name: "Acme", industry: "delivery", fleetSize: "1-5" },
      adminProfile: {
        name: "Alice",
        phone: "555-1234",
        timezone: "America/New_York",
      },
    });
    expect(r.success).toBe(false);
  });
});
