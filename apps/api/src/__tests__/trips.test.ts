import request from "supertest";
import { createTestApp, setupMockUser } from "./helpers/setup";
import { randomUUID } from "crypto";
const app = createTestApp();

// Get mocked modules
const { auth, db } = require("../config/firebase");

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
        
});