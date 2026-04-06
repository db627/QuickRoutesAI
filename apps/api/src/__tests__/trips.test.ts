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
});
function mockTripData(overrides: Partial<any> = {}) {
  return {
    driverId: null,
    createdBy: "dispatcher-uid",
    status: "draft",
    notes: "Initial notes",
    stops: [
      { stopId: "f3a1c6d2-9b7e-4a8f-8c2b-1d4e5f6a7b8c", address: "123 Main St", lat: 40, lng: -74, sequence: 0, notes: "Sign for package" },
      { stopId: "a9d2e3f1-4b6c-4e7f-b3a2-5d8c9f0a1b2c", address: "456 Oak Ave", lat: 41, lng: -75, sequence: 1, notes: "Pick up package" },
    ],
    route: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("PATCH /trips/:id", () => {
    const tripId = "trip-123";
    const uid = "dispatcher-123";


    it("updates notes and stops of a draft trip", async () => {
        setupMockUser(uid, "dispatcher", "Test Dispatcher");
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
            get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ role: "dispatcher" }) }),
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

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.notes).toBe("Updated notes");
        expect(res.body.stops).toEqual(newStops);
        expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ notes: "Updated notes", stops: newStops }));
        expect(addEventMock).toHaveBeenCalledWith(expect.objectContaining({ type: "trip_update" }));
    });

    it("returns 404 if trip does not exist", async () => {
        const mockTrip = mockTripData();

        const updateMock = jest.fn().mockResolvedValue(undefined);
        const addEventMock = jest.fn().mockResolvedValue(undefined);
        setupMockUser(uid, "dispatcher", "Test Dispatcher");
        db.collection.mockImplementation((col: string) => {
        if (col === "trips") {
            return {
            doc: (id: string) => ({
                get: jest.fn().mockResolvedValue({ exists: false }),
                update: updateMock,
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
            get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ role: "dispatcher" }) }),
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
        expect(res.body).toEqual({ error: "Not Found", message: "Trip not found" })
        expect(addEventMock).not.toHaveBeenCalled();
        expect(updateMock).not.toHaveBeenCalled();
      });

      it("returns 409 if trip is completed or cancelled", async () => {
        setupMockUser(uid, "dispatcher", "Test Dispatcher");
        const mockTrip = mockTripData({ status: "completed" });

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
            get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ role: "dispatcher" }) }),
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
        expect(res.body).toEqual({ error: "Bad Request", message: "Completed or cancelled trips cannot be updated" })
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
        expect(res.body).toEqual({ error: "Forbidden", message: "Requires one of: dispatcher, admin" })
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
        get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ role: "dispatcher" }) }),
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
        get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ role: "dispatcher" }) }),
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
        get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ role: "dispatcher" }) }),
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
            get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ role: "dispatcher" }) }),
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
        get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ role: "dispatcher" }) }),
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
    expect(res.body).toEqual({ error: "Not Found", message: "Trip not found" })
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
        get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ role: "dispatcher" }) }),
        set: jest.fn().mockResolvedValue(undefined),
    };
    });


    const res = await request(app)
    .delete(`/trips/${tripId}`)
    .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: "Bad Request", message: "Only draft trips can be deleted" })
    expect(addEventMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

});