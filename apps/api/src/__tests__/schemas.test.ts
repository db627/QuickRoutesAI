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
