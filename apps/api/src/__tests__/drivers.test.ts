import request from "supertest";
import { createTestApp, setupMockUser } from "./helpers/setup";
const app = createTestApp();
const { db } = require("../config/firebase");

// Mock global fetch if your route uses it (optional)
const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  jest.clearAllMocks();
});

// Helper to mock trips for "available" filter
function mockTripData(overrides: Partial<any> = {}) {
  return {
    driverId: null,
    status: "in_progress",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

import { Query } from "firebase-admin/firestore";

type MockQuery = {
  count: jest.Mock<any, any>;
  where: (field: string, op: any, value?: any) => MockQuery;
  orderBy: (field: string, dir?: "asc" | "desc") => MockQuery;
  offset: (n: number) => MockQuery;
  limit: (n: number) => MockQuery;
  startAfter: (...args: any[]) => MockQuery;
  get: jest.Mock<any, any>;
};

// Helper to mock driver documents
function mockDriverDoc(id: string, overrides: Partial<any> = {}) {
  return { id, isOnline: false, updatedAt: new Date().toISOString(), ...overrides };
}

describe("GET /drivers", () => {
  const uid = "dispatcher-123";

  it("returns all drivers when no filters", async () => {
    setupMockUser(uid, "dispatcher", "Test Dispatcher");

    const drivers = Array.from({ length: 25 }).map((_, i) =>
    mockDriverDoc(`driver${i + 1}`, {
        updatedAt: new Date(Date.now() - i * 1000).toISOString()
    })
    );

    let driverDocs = [...drivers];
    const users: Record<string, { name: string; email: string }> = {
    driver1: { name: "Alice", email: "alice@example.com" },
    driver2: { name: "Bob", email: "bob@example.com" },
    driver3: { name: "Charlie", email: "charlie@example.com" },
    driver4: { name: "David", email: "david@example.com" },
    driver5: { name: "Eva", email: "eva@example.com" },
    driver6: { name: "Frank", email: "frank@example.com" },
    driver7: { name: "Grace", email: "grace@example.com" },
    driver8: { name: "Hannah", email: "hannah@example.com" },
    driver9: { name: "Ian", email: "ian@example.com" },
    driver10: { name: "Julia", email: "julia@example.com" },
    driver11: { name: "Kevin", email: "kevin@example.com" },
    driver12: { name: "Laura", email: "laura@example.com" },
    driver13: { name: "Mike", email: "mike@example.com" },
    driver14: { name: "Nina", email: "nina@example.com" },
    driver15: { name: "Oscar", email: "oscar@example.com" },
    driver16: { name: "Paula", email: "paula@example.com" },
    driver17: { name: "Quentin", email: "quentin@example.com" },
    driver18: { name: "Rachel", email: "rachel@example.com" },
    driver19: { name: "Steve", email: "steve@example.com" },
    driver20: { name: "Tina", email: "tina@example.com" },
    driver21: { name: "Umar", email: "umar@example.com" },
    driver22: { name: "Vera", email: "vera@example.com" },
    driver23: { name: "Will", email: "will@example.com" },
    driver24: { name: "Xena", email: "xena@example.com" },
    driver25: { name: "Yara", email: "yara@example.com" },
    };
    const trips = [mockTripData({ driverId: "driver1" })];
    db.collection.mockImplementation((col: string) => {
        if (col === "drivers") {
    let driverDocs: Record<string, any>[] = [...drivers];

    let collectionMock: MockQuery; 

    collectionMock = {
      count: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({ data: () => ({ count: drivers.length }) }),
      })),
      where: jest.fn(() => collectionMock),
      orderBy: jest.fn((field: string, dir: "asc" | "desc" = "asc") => {
        return collectionMock;
      }),
      offset: jest.fn((offset: number) => {
        driverDocs = driverDocs.slice(offset);
        return collectionMock;
      }),
      limit: jest.fn((limit: number) => {
        driverDocs = driverDocs.slice(0, limit);
        return collectionMock;
      }),
      startAfter: jest.fn(() => collectionMock),
      get: jest.fn(() =>
        Promise.resolve({
          docs: driverDocs.map(d => ({ id: d.id, data: () => d })),
        }),
        ),
        };

        return collectionMock;
    }


      if (col === "users") {
        return {
            doc: (id: string) => {
                if (id === uid) {
                return {
                    get: jest.fn().mockResolvedValue({
                    exists: true,
                    data: () => ({ role: "dispatcher", active: true }),
                    }),
                };
                }
                return {
                get: jest.fn().mockResolvedValue({ exists: users[id] !== undefined, data: () => users[id] }),
                };
            },
        };
      }

      return { 
        doc: jest.fn().mockReturnThis(), 
        get: jest.fn(), 
        set: jest.fn(), };
    });

    const res = await request(app)
      .get("/drivers")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(20); 
    expect(res.body.data[0]).toMatchObject({ uid: "driver1", name: "Alice", isOnline: false });
    expect(res.body.total).toBe(25);

  });

  it("filters online drivers", async () => {
    setupMockUser(uid, "dispatcher", "Test Dispatcher");

    const drivers = Array.from({ length: 23 }).map((_, i) =>
    mockDriverDoc(`driver${i + 1}`, {
        updatedAt: new Date(Date.now() - i * 1000).toISOString()
    })
    );

    drivers.push(mockDriverDoc("driver24", { isOnline: true, updatedAt: new Date().toISOString() }));
    drivers.push(mockDriverDoc("driver25", { isOnline: true, updatedAt: new Date().toISOString() }));

    let driverDocs = [...drivers];
    const users: Record<string, { name: string; email: string }> = {
    driver1: { name: "Alice", email: "alice@example.com" },
    driver2: { name: "Bob", email: "bob@example.com" },
    driver3: { name: "Charlie", email: "charlie@example.com" },
    driver4: { name: "David", email: "david@example.com" },
    driver5: { name: "Eva", email: "eva@example.com" },
    driver6: { name: "Frank", email: "frank@example.com" },
    driver7: { name: "Grace", email: "grace@example.com" },
    driver8: { name: "Hannah", email: "hannah@example.com" },
    driver9: { name: "Ian", email: "ian@example.com" },
    driver10: { name: "Julia", email: "julia@example.com" },
    driver11: { name: "Kevin", email: "kevin@example.com" },
    driver12: { name: "Laura", email: "laura@example.com" },
    driver13: { name: "Mike", email: "mike@example.com" },
    driver14: { name: "Nina", email: "nina@example.com" },
    driver15: { name: "Oscar", email: "oscar@example.com" },
    driver16: { name: "Paula", email: "paula@example.com" },
    driver17: { name: "Quentin", email: "quentin@example.com" },
    driver18: { name: "Rachel", email: "rachel@example.com" },
    driver19: { name: "Steve", email: "steve@example.com" },
    driver20: { name: "Tina", email: "tina@example.com" },
    driver21: { name: "Umar", email: "umar@example.com" },
    driver22: { name: "Vera", email: "vera@example.com" },
    driver23: { name: "Will", email: "will@example.com" },
    driver24: { name: "Xena", email: "xena@example.com" },
    driver25: { name: "Yara", email: "yara@example.com" },
    };
    const trips = [mockTripData({ driverId: "driver1" })];
    db.collection.mockImplementation((col: string) => {
        if (col === "drivers") {
    let driverDocs: Record<string, any>[] = [...drivers];

    let collectionMock: MockQuery; 

    collectionMock = {
      count: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({
            data: () => ({ count: driverDocs.length }),
        }),
        })),
      where: jest.fn((field: string, op: string, value: any) => {
        driverDocs = driverDocs.filter((doc) => {
            const fieldValue = (doc as any)[field];

            switch (op) {
            case "==":
                return fieldValue === value;

            case "!=":
                return fieldValue !== value;

            case ">":
                return fieldValue > value;

            case ">=":
                return fieldValue >= value;

            case "<":
                return fieldValue < value;

            case "<=":
                return fieldValue <= value;

            case "in":
                return value.includes(fieldValue);

            case "not-in":
                return !value.includes(fieldValue);

            default:
                return true;
            }
        });

        return collectionMock;
        }),
      orderBy: jest.fn((field: string, dir: "asc" | "desc" = "asc") => {
        return collectionMock;
      }),
      offset: jest.fn((offset: number) => {
        driverDocs = driverDocs.slice(offset);
        return collectionMock;
      }),
      limit: jest.fn((limit: number) => {
        driverDocs = driverDocs.slice(0, limit);
        return collectionMock;
      }),
      startAfter: jest.fn(() => collectionMock),
      get: jest.fn(() =>
        Promise.resolve({
          docs: driverDocs.map(d => ({ id: d.id, data: () => d })),
        }),
        ),
        };

        return collectionMock;
    }


      if (col === "users") {
        return {
            doc: (id: string) => {
                if (id === uid) {
                return {
                    get: jest.fn().mockResolvedValue({
                    exists: true,
                    data: () => ({ role: "dispatcher", active: true }),
                    }),
                };
                }
                return {
                get: jest.fn().mockResolvedValue({ exists: users[id] !== undefined, data: () => users[id] }),
                };
            },
        };
      }

      if (col === "trips") {
        return {
          where: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ docs: trips.map(t => ({ data: () => t })) }) })),
        };
      }

      return { 
        doc: jest.fn().mockReturnThis(), 
        get: jest.fn(), 
        set: jest.fn(), };
    });

    const res = await request(app)
      .get("/drivers?online=true")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    expect(res.body.total).toBe(2);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.data).toMatchObject([
        { uid: "driver24", name: "Xena", isOnline: true },
        { uid: "driver25", name: "Yara", isOnline: true },
        ]);
  });

  it("filters available drivers (excludes busy)", async () => {
    setupMockUser(uid, "dispatcher", "Test Dispatcher");

    const drivers = Array.from({ length: 8 }).map((_, i) =>
    mockDriverDoc(`driver${i + 1}`, {
        updatedAt: new Date(Date.now() - i * 1000).toISOString()
    })
    );

    drivers.push(mockDriverDoc("driver9", { isOnline: true, updatedAt: new Date().toISOString() }));
    drivers.push(mockDriverDoc("driver10", { isOnline: true, updatedAt: new Date().toISOString() }));

    let driverDocs = [...drivers];
    const users: Record<string, { name: string; email: string }> = {
    driver1: { name: "Alice", email: "alice@example.com" },
    driver2: { name: "Bob", email: "bob@example.com" },
    driver3: { name: "Charlie", email: "charlie@example.com" },
    driver4: { name: "David", email: "david@example.com" },
    driver5: { name: "Eva", email: "eva@example.com" },
    driver6: { name: "Frank", email: "frank@example.com" },
    driver7: { name: "Grace", email: "grace@example.com" },
    driver8: { name: "Hannah", email: "hannah@example.com" },
    driver9: { name: "Ian", email: "ian@example.com" },
    driver10: { name: "Julia", email: "julia@example.com" },
    };
    const trips = [mockTripData({ driverId: "driver1" }), mockTripData({ driverId: "driver3" }), mockTripData({ driverId: "driver5" }), mockTripData({ driverId: "driver7" }), mockTripData({ driverId: "driver9" })];
    db.collection.mockImplementation((col: string) => {
        if (col === "drivers") {
    let driverDocs: Record<string, any>[] = [...drivers];

    let collectionMock: MockQuery; 

    collectionMock = {
      count: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({
            data: () => ({ count: driverDocs.length }),
        }),
        })),
      where: jest.fn((field: string, op: string, value: any) => {
        driverDocs = driverDocs.filter((doc) => {
            const fieldValue = 
            typeof field === "string" ? (doc as any)[field] : doc.id;

            switch (op) {
            case "==":
                return fieldValue === value;

            case "!=":
                return fieldValue !== value;

            case ">":
                return fieldValue > value;

            case ">=":
                return fieldValue >= value;

            case "<":
                return fieldValue < value;

            case "<=":
                return fieldValue <= value;

            case "in":
                return value.includes(fieldValue);

            case "not-in":
                return !value.includes(fieldValue);

            default:
                return true;
            }
        });

        return collectionMock;
        }),
      orderBy: jest.fn((field: string, dir: "asc" | "desc" = "asc") => {
        return collectionMock;
      }),
      offset: jest.fn((offset: number) => {
        driverDocs = driverDocs.slice(offset);
        return collectionMock;
      }),
      limit: jest.fn((limit: number) => {
        driverDocs = driverDocs.slice(0, limit);
        return collectionMock;
      }),
      startAfter: jest.fn(() => collectionMock),
      get: jest.fn(() =>
        Promise.resolve({
          docs: driverDocs.map(d => ({ id: d.id, data: () => d })),
        }),
        ),
        };

        return collectionMock;
    }


      if (col === "users") {
        return {
            doc: (id: string) => {
                if (id === uid) {
                return {
                    get: jest.fn().mockResolvedValue({
                    exists: true,
                    data: () => ({ role: "dispatcher", active: true }),
                    }),
                };
                }
                return {
                get: jest.fn().mockResolvedValue({ exists: users[id] !== undefined, data: () => users[id] }),
                };
            },
        };
      }

      if (col === "trips") {
        return {
          where: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ docs: trips.map(t => ({ data: () => t })) }) })),
        };
      }

      return { 
        doc: jest.fn().mockReturnThis(), 
        get: jest.fn(), 
        set: jest.fn(), };
    });

    const res = await request(app)
      .get("/drivers?available=true")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(5);
  });

  it("combines filters (online & available)", async () => {
    setupMockUser(uid, "dispatcher", "Test Dispatcher");

    const drivers = Array.from({ length: 8 }).map((_, i) =>
    mockDriverDoc(`driver${i + 1}`, {
        updatedAt: new Date(Date.now() - i * 1000).toISOString()
    })
    );

    drivers.push(mockDriverDoc("driver9", { isOnline: true, updatedAt: new Date().toISOString() }));
    drivers.push(mockDriverDoc("driver10", { isOnline: true, updatedAt: new Date().toISOString() }));

    let driverDocs = [...drivers];
    const users: Record<string, { name: string; email: string }> = {
    driver1: { name: "Alice", email: "alice@example.com" },
    driver2: { name: "Bob", email: "bob@example.com" },
    driver3: { name: "Charlie", email: "charlie@example.com" },
    driver4: { name: "David", email: "david@example.com" },
    driver5: { name: "Eva", email: "eva@example.com" },
    driver6: { name: "Frank", email: "frank@example.com" },
    driver7: { name: "Grace", email: "grace@example.com" },
    driver8: { name: "Hannah", email: "hannah@example.com" },
    driver9: { name: "Ian", email: "ian@example.com" },
    driver10: { name: "Julia", email: "julia@example.com" },
    };
    const trips = [mockTripData({ driverId: "driver1" }), mockTripData({ driverId: "driver3" }), mockTripData({ driverId: "driver5" }), mockTripData({ driverId: "driver7" }), mockTripData({ driverId: "driver9" })];
    db.collection.mockImplementation((col: string) => {
        if (col === "drivers") {
    let driverDocs: Record<string, any>[] = [...drivers];

    let collectionMock: MockQuery;

    collectionMock = {
      count: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({
            data: () => ({ count: driverDocs.length }),
        }),
        })),
      where: jest.fn((field: string, op: string, value: any) => {
        driverDocs = driverDocs.filter((doc) => {
            const fieldValue = 
            typeof field === "string" ? (doc as any)[field] : doc.id;

            switch (op) {
            case "==":
                return fieldValue === value;

            case "!=":
                return fieldValue !== value;

            case ">":
                return fieldValue > value;

            case ">=":
                return fieldValue >= value;

            case "<":
                return fieldValue < value;

            case "<=":
                return fieldValue <= value;

            case "in":
                return value.includes(fieldValue);

            case "not-in":
                return !value.includes(fieldValue);

            default:
                return true;
            }
        });

        return collectionMock;
        }),
      orderBy: jest.fn((field: string, dir: "asc" | "desc" = "asc") => {
        return collectionMock;
      }),
      offset: jest.fn((offset: number) => {
        driverDocs = driverDocs.slice(offset);
        return collectionMock;
      }),
      limit: jest.fn((limit: number) => {
        driverDocs = driverDocs.slice(0, limit);
        return collectionMock;
      }),
      startAfter: jest.fn(() => collectionMock),
      get: jest.fn(() =>
        Promise.resolve({
          docs: driverDocs.map(d => ({ id: d.id, data: () => d })),
        }),
        ),
        };

        return collectionMock;
    }


      if (col === "users") {
        return {
            doc: (id: string) => {
                if (id === uid) {
                return {
                    get: jest.fn().mockResolvedValue({
                    exists: true,
                    data: () => ({ role: "dispatcher", active: true }),
                    }),
                };
                }
                return {
                get: jest.fn().mockResolvedValue({ exists: users[id] !== undefined, data: () => users[id] }),
                };
            },
        };
      }

      if (col === "trips") {
        return {
          where: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ docs: trips.map(t => ({ data: () => t })) }) })),
        };
      }

      return { 
        doc: jest.fn().mockReturnThis(), 
        get: jest.fn(), 
        set: jest.fn(), };
    });

    const res = await request(app)
      .get("/drivers?online=true&available=true")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0]).toMatchObject({ uid: "driver10", name: "Julia", isOnline: true });
    });

    it("returns 403 if not dispatcher/admin", async () => {
        setupMockUser(uid, "driver", "Test Driver");

        const res = await request(app)
        .get("/drivers")
        .set("Authorization", "Bearer valid-token");
        expect(res.status).toBe(403);
    });
});