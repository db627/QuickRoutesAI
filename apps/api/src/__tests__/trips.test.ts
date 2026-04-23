import request from "supertest";
import { createTestApp, setupMockUser } from "./helpers/setup";
import { randomUUID } from "crypto";
const app = createTestApp();

// Get mocked modules
const { auth, db } = require("../config/firebase");
const { computeRoute } = require("../services/directions");

// Mock global fetch for Firebase REST API calls
const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  jest.clearAllMocks();
  db.collection = jest.fn();
  db.batch = jest.fn();
});
function mockTripData(overrides: Partial<any> = {}) {
  return {
    driverId: null,
    createdBy: "dispatcher-uid",
    status: "draft",
    notes: "Initial notes",
    route: null,
    orgId: "org-test",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("POST /trips", () => {
  const uid = "dispatcher-123";

  it("returns a well-shaped Trip (id, stops, status, createdAt, updatedAt, route, driverId, createdBy, notes)", async () => {
    setupMockUser(uid, "dispatcher", "Test Dispatcher");

    const commitMock = jest.fn().mockResolvedValue(undefined);
    const setMock = jest.fn();
    db.batch = jest.fn(() => ({ set: setMock, commit: commitMock }));

    // Generate distinct stop doc ids per call so stopIds end up unique.
    let stopIdCounter = 0;
    const addMock = jest.fn().mockResolvedValue({
      id: "new-trip-id",
      collection: (subcol: string) => {
        if (subcol === "stops") {
          return {
            doc: () => ({ id: `generated-stop-${++stopIdCounter}` }),
          };
        }
        return {};
      },
    });

    db.collection.mockImplementation((col: string) => {
      if (col === "users") {
        return {
          doc: () => ({
            get: jest.fn().mockResolvedValue({
              exists: true,
              data: () => ({ role: "dispatcher", orgId: "org-test" }),
            }),
          }),
        };
      }
      if (col === "trips") {
        return { add: addMock };
      }
      return {
        doc: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ role: "dispatcher", orgId: "org-test" }) }),
        set: jest.fn().mockResolvedValue(undefined),
      };
    });

    const res = await request(app)
      .post("/trips")
      .send({
        stops: [
          { address: "123 Main St", contactName: "Alice", lat: 40, lng: -74, sequence: 0, notes: "" },
          { address: "456 Oak Ave", contactName: "Bob", lat: 41, lng: -75, sequence: 1, notes: "" },
        ],
      })
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: "new-trip-id",
      driverId: null,
      createdBy: uid,
      status: "draft",
      route: null,
      notes: null,
    });
    expect(typeof res.body.createdAt).toBe("string");
    expect(typeof res.body.updatedAt).toBe("string");
    expect(Array.isArray(res.body.stops)).toBe(true);
    expect(res.body.stops).toHaveLength(2);
    expect(res.body.stops[0]).toMatchObject({
      address: "123 Main St",
      contactName: "Alice",
      lat: 40,
      lng: -74,
      sequence: 0,
      notes: "",
    });
    expect(res.body.stops[0].stopId).toBeTruthy();
    expect(res.body.stops[1]).toMatchObject({
      address: "456 Oak Ave",
      contactName: "Bob",
      lat: 41,
      lng: -75,
      sequence: 1,
    });
    expect(res.body.stops[1].stopId).toBeTruthy();
    expect(setMock).toHaveBeenCalledTimes(2);
    expect(commitMock).toHaveBeenCalledTimes(1);
  });
});

describe("PATCH /trips/:id", () => {
    const tripId = "trip-123";
    const uid = "dispatcher-123";

    beforeEach(() => {
        jest.clearAllMocks();
        db.collection = jest.fn();
    });

    it("updates notes and stops of a draft trip", async () => {
        setupMockUser(uid, "dispatcher", "Test Dispatcher");

        const mockTrip = mockTripData();
        
        const updateMock = jest.fn().mockResolvedValue(undefined);
        const addEventMock = jest.fn().mockResolvedValue(undefined);
        const deleteMock = jest.fn().mockResolvedValue(undefined);
        const setMock = jest.fn().mockResolvedValue(undefined);

        const existingStops = [
        { stopId: "old-1", address: "Hazlet, NJ", lat: 40.42, lng: -74.16, sequence: 0, notes: "" },
        { stopId: "old-2", address: "Middletown, NJ", lat: 40.39, lng: -74.11, sequence: 1, notes: "" },
        ];

        const newStops = [
        {
            stopId: "f3a1c6d2-9b7e-4a8f-8c2b-1d4e5f6a7b8c",
            address: "123 Main St",
            lat: 40,
            lng: -74,
            sequence: 0,
            notes: "",
        },
        {
            stopId: "a9d2e3f1-4b6c-4e7f-b3a2-5d8c9f0a1b2c",
            address: "456 Oak Ave",
            lat: 41,
            lng: -75,
            sequence: 1,
            notes: "Pickup",
        },
        ];

        db.collection.mockImplementation((col: string) => {
        if (col === "users") {
            return {
            doc: (id: string) => ({
                get: jest.fn().mockResolvedValue({
                exists: id === uid,
                data: () => ({ role: "dispatcher", orgId: "org-test" }),
                }),
            }),
            };
        }

        if (col === "trips") {
            return {
            doc: (id: string) => ({
                get: jest.fn().mockResolvedValue({
                exists: id === tripId,
                data: () => mockTrip,
                }),
                update: updateMock,
                collection: (subcol: string) => {
                if (subcol === "stops") {
                    return {
                    get: jest.fn().mockResolvedValue({
                        empty: false,
                        docs: existingStops.map((stop) => ({
                        data: () => stop,
                        })),
                    }),
                    doc: (stopId?: string) => ({
                        id: stopId ?? "generated-stop-id",
                        set: setMock,
                        delete: deleteMock,
                    }),
                    };
                }
                return {};
                },
            }),
            };
        }

        if (col === "events") {
            return {
            add: addEventMock,
            };
        }

        return {
            doc: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ role: "dispatcher", orgId: "org-test" }),
            }),
        };
        });

        const res = await request(app)
        .patch(`/trips/${tripId}`)
        .send({ notes: "Updated notes", stops: newStops })
        .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.notes).toBe("Updated notes");

        
        expect(res.body.stops).toEqual(newStops);

        expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
            notes: "Updated notes",
            stopCount: newStops.length,
            updatedAt: expect.any(String),
        }),
        );

        // Both old stops are deleted because neither old stopId exists in newStops
        expect(deleteMock).toHaveBeenCalledTimes(2);

        // Both incoming stops are written back
        expect(setMock).toHaveBeenCalledTimes(2);
        expect(setMock).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
            stopId: "f3a1c6d2-9b7e-4a8f-8c2b-1d4e5f6a7b8c",
            address: "123 Main St",
            lat: 40,
            lng: -74,
            sequence: 0,
            notes: "",
        }),
        );
        expect(setMock).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
            stopId: "a9d2e3f1-4b6c-4e7f-b3a2-5d8c9f0a1b2c",
            address: "456 Oak Ave",
            lat: 41,
            lng: -75,
            sequence: 1,
            notes: "Pickup",
        }),
        );

        expect(addEventMock).toHaveBeenCalledWith(
        expect.objectContaining({
            type: "trip_update",
            uid,
        }),
        );
    });

    it("returns 404 if trip does not exist", async () => {
        const mockTrip = mockTripData();

        const updateMock = jest.fn().mockResolvedValue(undefined);
        const addEventMock = jest.fn().mockResolvedValue(undefined);
        const stops = [
        { stopId: "old-1", address: "Hazlet, NJ", lat: 40.42, lng: -74.16, sequence: 0, notes: "" },
        { stopId: "old-2", address: "Middletown, NJ", lat: 40.39, lng: -74.11, sequence: 1, notes: "" },
        ];
        setupMockUser(uid, "dispatcher", "Test Dispatcher");
        db.collection.mockImplementation((col: string) => {
        if (col === "trips") {
        return {
          doc: (id: string) => ({
            get: jest.fn().mockResolvedValue({
              exists: false,
              data: () => mockTrip,
            }),
            collection: (subcol: string) => {
              if (subcol === "stops") {
                return {
                  get: jest.fn().mockResolvedValue({
                    empty: false,
                    docs: stops.map((stop) => ({
                      data: () => stop,
                    })),
                  }),
                };
              }
              return {};
            },
          }),
          
        };
      }

        if (col === "events"){
          return {
            add: addEventMock,
          }
        }

        return {
            doc: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ role: "dispatcher", orgId: "org-test" }) }),
            set: jest.fn().mockResolvedValue(undefined),
        };
        });

        const newStops = [
        { stopId: "f3a1c6d2-9b7e-4a8f-8c2b-1d4e5f6a7b8c", address: "123 Main St", lat: 40, lng: -74, sequence: 0, notes: "" },
        { stopId: "a9d2e3f1-4b6c-4e7f-b3a2-5d8c9f0a1b2c", address: "456 Oak Ave", lat: 41, lng: -75, sequence: 1, notes: "Pickup" },
        ];

        const res = await request(app)
        .patch(`/trips/${tripId}`)
        .send({ notes: "Updated notes" })
        .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(404)
        expect(res.body).toEqual({ error: "TRIP_NOT_FOUND", message: "Trip not found" })
        expect(addEventMock).not.toHaveBeenCalled();
        expect(updateMock).not.toHaveBeenCalled();
      });

      it("returns 409 if trip is completed or cancelled", async () => {
        setupMockUser(uid, "dispatcher", "Test Dispatcher");
        const mockTrip = mockTripData({ status: "completed" });

        const updateMock = jest.fn().mockResolvedValue(undefined);
        const addEventMock = jest.fn().mockResolvedValue(undefined);

        const stops = [
        { stopId: "f3a1c6d2-9b7e-4a8f-8c2b-1d4e5f6a7b8c", address: "123 Main St", lat: 40, lng: -74, sequence: 0, notes: "" },
        { stopId: "a9d2e3f1-4b6c-4e7f-b3a2-5d8c9f0a1b2c", address: "456 Oak Ave", lat: 41, lng: -75, sequence: 1, notes: "Pickup" },
        ];
        db.collection.mockImplementation((col: string) => {
        if (col === "trips") {
        return {
          doc: (id: string) => ({
            get: jest.fn().mockResolvedValue({
              exists: id === tripId,
              data: () => mockTrip,
            }),
            collection: (subcol: string) => {
              if (subcol === "stops") {
                return {
                  get: jest.fn().mockResolvedValue({
                    empty: false,
                    docs: stops.map((stop) => ({
                      data: () => stop,
                    })),
                  }),
                };
              }
              return {};
            },
          }),
          
        };
      }

        if (col === "events") {
            return {
            add: addEventMock,
            };
        }

        return {
            doc: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ role: "dispatcher", orgId: "org-test" }) }),
            set: jest.fn().mockResolvedValue(undefined),
        };
        });

        const newStops = [
        { stopId: "f3a1c6d2-9b7e-4a8f-8c2b-1d4e5f6a7b8c", address: "123 Main St", lat: 40, lng: -74, sequence: 0, notes: "" },
        { stopId: "a9d2e3f1-4b6c-4e7f-b3a2-5d8c9f0a1b2c", address: "456 Oak Ave", lat: 41, lng: -75, sequence: 1, notes: "Pickup" },
        ];

        const res = await request(app)
        .patch(`/trips/${tripId}`)
        .send({ notes: "Updated notes", stops: newStops })
        .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(409)
        expect(res.body).toEqual({ error: "CONFLICT", message: "Completed or cancelled trips cannot be updated" })
        expect(addEventMock).not.toHaveBeenCalled();
        expect(updateMock).not.toHaveBeenCalled();
      });

      it("returns 403 if user is not dispatcher or admin", async () => {
        setupMockUser(uid, "driver", "Test Driver");
        const mockTrip = mockTripData();

        const updateMock = jest.fn().mockResolvedValue(undefined);
        const addEventMock = jest.fn().mockResolvedValue(undefined);

        db.collection.mockImplementation((col: string) => {
        if (col === "trips") {
            return {
            doc: (id: string) => ({
                get: jest.fn().mockResolvedValue({ exists: true, data: () => mockTrip }),
                update: updateMock,
            }),
            };
        }

        if (col === "events") {
            return {
            add: addEventMock,
            };
        }

        return {
            doc: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ role: "driver" }) }),
            set: jest.fn().mockResolvedValue(undefined),
        };
        });

        const res = await request(app)
        .patch(`/trips/${tripId}`)
        .send({ notes: "Updated notes" })
        .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(403)
        expect(res.body).toEqual({ error: "FORBIDDEN", message: "Requires one of: dispatcher, admin" })
        expect(addEventMock).not.toHaveBeenCalled();
        expect(updateMock).not.toHaveBeenCalled();
        });

});

describe("POST /trips/:id/route", () => {
  const tripId = "trip-123";
  const uid = "dispatcher-123";

  const mockStops = [
    { stopId: "stop-1", address: "123 Main St", lat: 40, lng: -74, sequence: 0, notes: "" },
    { stopId: "stop-2", address: "456 Oak Ave", lat: 41, lng: -75, sequence: 1, notes: "" },
    { stopId: "stop-3", address: "789 Pine Rd", lat: 42, lng: -76, sequence: 2, notes: "" },
  ];

  const mockRoute = {
    polyline: "abc123",
    distanceMeters: 50000,
    durationSeconds: 3600,
    naiveDistanceMeters: 60000,
    fuelSavingsGallons: 0.12,
    reasoning: "Visiting stop 2 before stop 1 minimizes backtracking.",
  };

  it("computes and saves route with reasoning for a dispatcher", async () => {
    setupMockUser(uid, "dispatcher", "Test Dispatcher");
    computeRoute.mockResolvedValue({ route: mockRoute, optimizedStops: mockStops });

    const updateMock = jest.fn().mockResolvedValue(undefined);

    db.collection.mockImplementation((col: string) => {
      if (col === "trips") {
        return {
          doc: () => ({
            get: jest.fn().mockResolvedValue({ exists: true, data: () => mockTripData({ stops: mockStops }) }),
            update: updateMock,
          }),
        };
      }
      return {
        doc: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ role: "dispatcher", orgId: "org-test" }) }),
        set: jest.fn().mockResolvedValue(undefined),
      };
    });

    const res = await request(app)
      .post(`/trips/${tripId}/route`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.route).toMatchObject({ reasoning: "Visiting stop 2 before stop 1 minimizes backtracking." });
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ route: mockRoute, stops: mockStops }));
  });

  it("returns 404 if trip does not exist", async () => {
    setupMockUser(uid, "dispatcher", "Test Dispatcher");

    db.collection.mockImplementation((col: string) => {
      if (col === "trips") {
        return {
          doc: () => ({
            get: jest.fn().mockResolvedValue({ exists: false }),
          }),
        };
      }
      return {
        doc: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ role: "dispatcher", orgId: "org-test" }) }),
        set: jest.fn().mockResolvedValue(undefined),
      };
    });

    const res = await request(app)
      .post(`/trips/${tripId}/route`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not Found", message: "Trip not found" });
  });

  it("returns 400 if trip has fewer than 2 stops", async () => {
    setupMockUser(uid, "dispatcher", "Test Dispatcher");

    db.collection.mockImplementation((col: string) => {
      if (col === "trips") {
        return {
          doc: () => ({
            get: jest.fn().mockResolvedValue({
              exists: true,
              data: () => mockTripData({ stops: [mockStops[0]] }),
            }),
          }),
        };
      }
      return {
        doc: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ role: "dispatcher", orgId: "org-test" }) }),
        set: jest.fn().mockResolvedValue(undefined),
      };
    });

    const res = await request(app)
      .post(`/trips/${tripId}/route`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Bad Request", message: "Need at least 2 stops to compute route" });
  });

  it("returns 403 if user is a driver", async () => {
    setupMockUser(uid, "driver", "Test Driver");

    const res = await request(app)
      .post(`/trips/${tripId}/route`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });
});

describe("DELETE /trips/:id", () => {
  const tripId = "trip-123";
  const uid = "dispatcher-123";

  it("deletes a draft trip", async () => {
    setupMockUser(uid, "dispatcher", "Test Dispatcher");
    const deleteMock = jest.fn().mockResolvedValue(undefined);
    const addEventMock = jest.fn().mockResolvedValue(undefined);
    const mockTrip = mockTripData();

    db.collection.mockImplementation((col: string) => {
        if (col === "trips") {
            return {
            doc: (id: string) => ({
                get: jest.fn().mockResolvedValue({ exists: true, data: () => mockTrip }),
                delete: deleteMock,
            }),
            };
        }

        if (col === "events") {
            return {
            add: addEventMock,
            };
        }

        return {
            doc: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ role: "dispatcher", orgId: "org-test" }) }),
            set: jest.fn().mockResolvedValue(undefined),
        };
      });

    const res = await request(app)
    .delete(`/trips/${tripId}`)
    .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, message: "Trip deleted" });
    expect(deleteMock).toHaveBeenCalled();
    expect(addEventMock).toHaveBeenCalledWith(expect.objectContaining({ type: "trip_delete" }));
  });

  it("returns 404 if trip does not exist", async () => {
    setupMockUser(uid, "dispatcher", "Test Dispatcher");
    const deleteMock = jest.fn().mockResolvedValue(undefined);
    const addEventMock = jest.fn().mockResolvedValue(undefined);

    db.collection.mockImplementation((col: string) => {
    if (col === "trips") {
        return {
        doc: (id: string) => ({
            get: jest.fn().mockResolvedValue({ exists: false }),
            delete: deleteMock,
        }),
        };
    }

    if (col === "events"){
      return {
        add: addEventMock,
      }
    }

    return {
        doc: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ role: "dispatcher", orgId: "org-test" }) }),
        set: jest.fn().mockResolvedValue(undefined),
    };
    });

    const newStops = [
    { stopId: "f3a1c6d2-9b7e-4a8f-8c2b-1d4e5f6a7b8c", address: "123 Main St", lat: 40, lng: -74, sequence: 0, notes: "" },
    { stopId: "a9d2e3f1-4b6c-4e7f-b3a2-5d8c9f0a1b2c", address: "456 Oak Ave", lat: 41, lng: -75, sequence: 1, notes: "Pickup" },
    ];

    const res = await request(app)
    .delete(`/trips/${tripId}`)
    .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: "TRIP_NOT_FOUND", message: "Trip not found" })
    expect(addEventMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });


  it("returns 409 if trip is not in draft status", async () => {
    setupMockUser(uid, "dispatcher", "Test Dispatcher");
    const mockTrip = mockTripData({ status: "assigned" });

    const deleteMock = jest.fn().mockResolvedValue(undefined);
    const addEventMock = jest.fn().mockResolvedValue(undefined);

    db.collection.mockImplementation((col: string) => {
    if (col === "trips") {
        return {
        doc: (id: string) => ({
            get: jest.fn().mockResolvedValue({ exists: true, data: () => mockTrip }),
            delete: deleteMock,
        }),
        };
    }

    if (col === "events") {
        return {
        add: addEventMock,
        };
    }

    return {
        doc: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ role: "dispatcher", orgId: "org-test" }) }),
        set: jest.fn().mockResolvedValue(undefined),
    };
    });


    const res = await request(app)
    .delete(`/trips/${tripId}`)
    .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: "CONFLICT", message: "Only draft trips can be deleted" })
    expect(addEventMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

});

describe("Org isolation for /trips", () => {
  const uid = "dispatcher-1";
  const tripId = "trip-xyz";

  beforeEach(() => {
    jest.clearAllMocks();
    db.collection = jest.fn();
    db.batch = jest.fn();
  });

  it("GET /trips → 403 when the caller has no orgId", async () => {
    // setupMockUser(..., null) installs a users mock with no orgId.
    setupMockUser(uid, "dispatcher", "Test Dispatcher", null);

    const res = await request(app)
      .get("/trips")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("FORBIDDEN");
    expect(res.body.message).toMatch(/not linked to an organization/i);
  });

  it("GET /trips/:id → 403 when trip belongs to a different org", async () => {
    setupMockUser(uid, "dispatcher", "Test Dispatcher", "org-alpha");
    const foreignTrip = mockTripData({ orgId: "org-beta" });

    db.collection.mockImplementation((col: string) => {
      if (col === "users") {
        return {
          doc: (id: string) => ({
            get: jest.fn().mockResolvedValue({
              exists: id === uid,
              data: () => ({ role: "dispatcher", orgId: "org-alpha" }),
            }),
          }),
        };
      }
      if (col === "trips") {
        return {
          doc: () => ({
            get: jest.fn().mockResolvedValue({ exists: true, data: () => foreignTrip }),
            collection: () => ({
              // tripStopsValidationGuard needs at least one stop to avoid 400
              get: jest.fn().mockResolvedValue({
                empty: false,
                docs: [
                  {
                    data: () => ({ stopId: "s1", address: "x", lat: 1, lng: 1, sequence: 0, notes: "" }),
                  },
                ],
              }),
            }),
          }),
        };
      }
      return {
        doc: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ exists: false }),
      };
    });

    const res = await request(app)
      .get(`/trips/${tripId}`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("FORBIDDEN");
  });

  it("GET /trips/:id → 403 when trip has no orgId (legacy)", async () => {
    setupMockUser(uid, "dispatcher", "Test Dispatcher", "org-alpha");
    const legacyTrip = mockTripData();
    delete (legacyTrip as any).orgId;

    db.collection.mockImplementation((col: string) => {
      if (col === "users") {
        return {
          doc: (id: string) => ({
            get: jest.fn().mockResolvedValue({
              exists: id === uid,
              data: () => ({ role: "dispatcher", orgId: "org-alpha" }),
            }),
          }),
        };
      }
      if (col === "trips") {
        return {
          doc: () => ({
            get: jest.fn().mockResolvedValue({ exists: true, data: () => legacyTrip }),
            collection: () => ({
              get: jest.fn().mockResolvedValue({
                empty: false,
                docs: [
                  {
                    data: () => ({ stopId: "s1", address: "x", lat: 1, lng: 1, sequence: 0, notes: "" }),
                  },
                ],
              }),
            }),
          }),
        };
      }
      return { doc: jest.fn().mockReturnThis(), get: jest.fn().mockResolvedValue({ exists: false }) };
    });

    const res = await request(app)
      .get(`/trips/${tripId}`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("FORBIDDEN");
  });

  it("POST /trips → stamps orgId from req.orgId on the new doc", async () => {
    setupMockUser(uid, "dispatcher", "Test Dispatcher", "org-alpha");

    const addTripMock = jest.fn().mockResolvedValue({
      id: "new-trip-abc",
      collection: () => ({
        doc: () => ({ id: "stop-1" }),
      }),
    });
    const batchSetMock = jest.fn();
    const batchCommitMock = jest.fn().mockResolvedValue(undefined);
    db.batch.mockReturnValue({ set: batchSetMock, commit: batchCommitMock });

    db.collection.mockImplementation((col: string) => {
      if (col === "users") {
        return {
          doc: (id: string) => ({
            get: jest.fn().mockResolvedValue({
              exists: id === uid,
              data: () => ({ role: "dispatcher", orgId: "org-alpha" }),
            }),
          }),
        };
      }
      if (col === "trips") {
        return { add: addTripMock };
      }
      return { doc: jest.fn().mockReturnThis(), get: jest.fn().mockResolvedValue({ exists: false }) };
    });

    const res = await request(app)
      .post("/trips")
      .send({
        stops: [
          { address: "A", lat: 40, lng: -74 },
          { address: "B", lat: 41, lng: -75 },
        ],
      })
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(201);
    expect(addTripMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-alpha",
        createdBy: uid,
        status: "draft",
        stopCount: 2,
      }),
    );
    expect(res.body).toMatchObject({ stopCount: 2 });
  });

  it("POST /trips → 403 when the caller has no orgId", async () => {
    setupMockUser(uid, "dispatcher", "Test Dispatcher", null);

    const res = await request(app)
      .post("/trips")
      .send({
        stops: [
          { address: "A", lat: 40, lng: -74 },
          { address: "B", lat: 41, lng: -75 },
        ],
      })
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("FORBIDDEN");
  });

  it("DELETE /trips/:id → 403 when trip belongs to a different org", async () => {
    setupMockUser(uid, "dispatcher", "Test Dispatcher", "org-alpha");
    const foreignTrip = mockTripData({ orgId: "org-beta" });
    const deleteMock = jest.fn();
    const addEventMock = jest.fn();

    db.collection.mockImplementation((col: string) => {
      if (col === "users") {
        return {
          doc: (id: string) => ({
            get: jest.fn().mockResolvedValue({
              exists: id === uid,
              data: () => ({ role: "dispatcher", orgId: "org-alpha" }),
            }),
          }),
        };
      }
      if (col === "trips") {
        return {
          doc: () => ({
            get: jest.fn().mockResolvedValue({ exists: true, data: () => foreignTrip }),
            delete: deleteMock,
          }),
        };
      }
      if (col === "events") {
        return { add: addEventMock };
      }
      return { doc: jest.fn().mockReturnThis(), get: jest.fn().mockResolvedValue({ exists: false }) };
    });

    const res = await request(app)
      .delete(`/trips/${tripId}`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
    expect(deleteMock).not.toHaveBeenCalled();
    expect(addEventMock).not.toHaveBeenCalled();
  });
});