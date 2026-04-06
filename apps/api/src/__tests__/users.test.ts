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
function mockUserData(overrides: Partial<any> = {}) {
  return {
    email: "test@example.com",
    name: "Test User",
    role: "driver",
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

jest.mock("../utils/paginateFirestore", () => ({
  paginateFirestore: jest.fn(),
}));

const { paginateFirestore } = require("../utils/paginateFirestore");

describe("GET /users", () => {
    it("returns paginated users for admin", async () => {
        const uid = "admin-123";
        setupMockUser(uid, "admin", "Admin User");

        const mockResult = {
        data: [{ id: "user1" }, { id: "user2" }],
        total: 2,
        page: 1,
        hasMore: false,
        };

        const whereMock = jest.fn().mockReturnThis();

        db.collection.mockImplementation((col: string) => {
        if (col === "users") {
            return {
            doc: (id: string) => {
                if (id === uid) {
                return {
                    get: jest.fn().mockResolvedValue({
                    exists: true,
                    data: () => ({ role: "admin", active: true }),
                    }),
                };
                }

                return {
                get: jest.fn().mockResolvedValue({ exists: false }),
                };
            },
            where: whereMock,
            };
        }

        return {
            doc: jest.fn().mockReturnThis(),
            get: jest.fn(),
            set: jest.fn(),
        };
        });

        paginateFirestore.mockResolvedValue(mockResult);

        const res = await request(app)
        .get("/users")
        .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(200);
        expect(res.body.data.length).toBe(2);
        expect(paginateFirestore).toHaveBeenCalled();
    });

    it("filters drivers when role=driver", async () => {
        const uid = "admin-123";
        setupMockUser(uid, "admin", "Admin User");


        paginateFirestore.mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        hasMore: false,
        });

        const whereMock = jest.fn().mockReturnThis();

        db.collection.mockImplementation((col: string) => {
        if (col === "users") {
            return {
            doc: (id: string) => {
                if (id === uid) {
                return {
                    get: jest.fn().mockResolvedValue({
                    exists: true,
                    data: () => ({ role: "admin", active: true }),
                    }),
                };
                }

                return {
                get: jest.fn().mockResolvedValue({ exists: false }),
                };
            },
            where: whereMock,
            };
        }

        return {
            doc: jest.fn().mockReturnThis(),
            get: jest.fn(),
            set: jest.fn(),
        };
        });

        const res = await request(app)
        .get("/users?role=driver")
        .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(200);
        expect(whereMock).toHaveBeenCalledWith("role", "==", "driver");
    });

    it("returns 403 if user is not dispatcher or admin", async () => {
        const uid = "driver-123";
        setupMockUser(uid, "driver", "Driver");

        const res = await request(app)
        .get("/users")
        .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(403);
    });
});

describe("PATCH /users/:id", () => {
    const userId = "user-123";
    const uid = "admin-123";


    it("updates user information", async () => {
        setupMockUser(uid, "admin", "Test Admin");
        const mockUser = mockUserData();

        const updateMock = jest.fn().mockResolvedValue(undefined);
        const addEventMock = jest.fn().mockResolvedValue(undefined);

        db.collection.mockImplementation((col: string) => {
            if (col === "users") {
                return {
                doc: (id: string) => {
                    if (id === uid) {

                    return {
                        get: jest.fn().mockResolvedValue({
                        exists: true,
                        data: () => ({ role: "admin", active: true }),
                        }),
                    };
                    }

                    if (id === userId) {
                    return {
                        get: jest.fn().mockResolvedValue({
                        exists: true,
                        data: () => mockUser,
                        }),
                        update: updateMock,
                    };
                    }

                    return {
                    get: jest.fn().mockResolvedValue({ exists: false }),
                    };
                },
                };
            }

            if (col === "events") {
                return {
                add: addEventMock,
                };
            }

            return {
                doc: jest.fn().mockReturnThis(),
                get: jest.fn(),
                set: jest.fn(),
            };
        });

        const res = await request(app)
        .patch(`/users/${userId}`)
        .send({ role: "admin", status: "deactivated" })
        .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ role: "admin", status: "deactivated" }));
        expect(addEventMock).toHaveBeenCalledWith(expect.objectContaining({ type: "user_updated" }));
    });

    it("returns 404 when user being updated does not exist", async () => {
        setupMockUser(uid, "admin", "Test Admin");

        db.collection.mockImplementation((col: string) => {
        if (col === "users") {
            return {
            doc: (id: string) => {
                if (id === uid) {
                return {
                    get: jest.fn().mockResolvedValue({
                    exists: true,
                    data: () => ({ role: "admin", active: true }),
                    }),
                };
                }

                if (id === userId) {
                return {
                    get: jest.fn().mockResolvedValue({
                    exists: false,
                    }),
                };
                }

                return {
                get: jest.fn().mockResolvedValue({ exists: false }),
                };
            },
            };
        }

        return {
            doc: jest.fn().mockReturnThis(),
            get: jest.fn(),
            set: jest.fn(),
        };
        });

        const res = await request(app)
        .patch(`/users/${userId}`)
        .send({ role: "admin" })
        .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(404);
        expect(res.body.error).toBeDefined();
  });

    it("returns 403 when caller is not an admin", async () => {
        const nonAdminUid = "driver-123";
        setupMockUser(nonAdminUid, "driver", "Test Driver");

        db.collection.mockImplementation((col: string) => {
        if (col === "users") {
            return {
            doc: (id: string) => {
                if (id === nonAdminUid) {
                return {
                    get: jest.fn().mockResolvedValue({
                    exists: true,
                    data: () => ({ role: "driver", active: true }),
                    }),
                };
                }

                if (id === userId) {
                return {
                    get: jest.fn().mockResolvedValue({
                    exists: true,
                    data: () => mockUserData(),
                    }),
                };
                }

                return {
                get: jest.fn().mockResolvedValue({ exists: false }),
                };
            },
            };
        }

        return {
            doc: jest.fn().mockReturnThis(),
            get: jest.fn(),
            set: jest.fn(),
        };
        });

        const res = await request(app)
        .patch(`/users/${userId}`)
        .send({ role: "admin" })
        .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(403);
        expect(res.body.error).toBeDefined();
    });

});

describe("DELETE /users/:id", () => {
    const userId = "user-123";
    const uid = "admin-123";

    it("deletes a user", async () => {
        setupMockUser(uid, "admin", "Test Admin");

        const deleteProfileMock = jest.fn().mockResolvedValue(undefined);
        const deleteAuthMock = jest.fn().mockResolvedValue(undefined);
        const addEventMock = jest.fn().mockResolvedValue(undefined);

        auth.deleteUser = jest.fn().mockResolvedValue(undefined);
        db.collection.mockImplementation((col: string) => {
            if (col === "users") {
                return {
                doc: (id: string) => {
                    if (id === uid) {
                    return {
                        get: jest.fn().mockResolvedValue({
                        exists: true,
                        data: () => ({ role: "admin", active: true }),
                        }),
                    };
                    }
                    if (id === userId) {
                    return {
                        get: jest.fn().mockResolvedValue({
                        exists: true,
                        data: () => mockUserData(),
                        }),
                        delete: deleteProfileMock,
                    };
                    }
                    return {
                    get: jest.fn().mockResolvedValue({ exists: false }),
                    };
                },
                };
            }

            if (col === "events") {
                return {
                add: addEventMock,
                };
            }

            return {
                doc: jest.fn().mockReturnThis(),
                get: jest.fn(),
                set: jest.fn(),
            };
        });

        const res = await request(app)
        .delete(`/users/${userId}`)
        .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(deleteProfileMock).toHaveBeenCalled();
        expect(auth.deleteUser).toHaveBeenCalledWith(userId);
        expect(addEventMock).toHaveBeenCalledWith(expect.objectContaining({ type: "user_deleted" }));
        });

    it("404 error user is not found", async () => {
        setupMockUser(uid, "admin", "Test Admin");

        const deleteProfileMock = jest.fn().mockResolvedValue(undefined);
        const deleteAuthMock = jest.fn().mockResolvedValue(undefined);
        const addEventMock = jest.fn().mockResolvedValue(undefined);

        auth.deleteUser = jest.fn().mockResolvedValue(undefined);
        db.collection.mockImplementation((col: string) => {
            if (col === "users") {
                return {
                doc: (id: string) => {
                    if (id === uid) {
                    return {
                        get: jest.fn().mockResolvedValue({
                        exists: true,
                        data: () => ({ role: "admin", active: true }),
                        }),
                    };
                    }
                    if (id === userId) {
                    return {
                        get: jest.fn().mockResolvedValue({
                        exists: false,
                        data: () => mockUserData(),
                        }),
                        delete: deleteProfileMock,
                    };
                    }
                    return {
                    get: jest.fn().mockResolvedValue({ exists: false }),
                    };
                },
                };
            }

            if (col === "events") {
                return {
                add: addEventMock,
                };
            }

            return {
                doc: jest.fn().mockReturnThis(),
                get: jest.fn(),
                set: jest.fn(),
            };
        });

        const res = await request(app)
        .delete(`/users/${userId}`)
        .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(404);
        expect(res.body.error).toBe("Not Found");
        expect(res.body.message).toBe("User not found");
    });

    it("403 error if endpoint is called by non-admin role", async () => {
        setupMockUser(uid, "user", "Test User");

        const deleteProfileMock = jest.fn().mockResolvedValue(undefined);
        const deleteAuthMock = jest.fn().mockResolvedValue(undefined);
        const addEventMock = jest.fn().mockResolvedValue(undefined);

        auth.deleteUser = jest.fn().mockResolvedValue(undefined);
        db.collection.mockImplementation((col: string) => {
            if (col === "users") {
                return {
                doc: (id: string) => {
                    if (id === uid) {
                    return {
                        get: jest.fn().mockResolvedValue({
                        exists: true,
                        data: () => ({ role: "user", active: true }),
                        }),
                    };
                    }
                    if (id === userId) {
                    return {
                        get: jest.fn().mockResolvedValue({
                        exists: true,
                        data: () => mockUserData(),
                        }),
                        delete: deleteProfileMock,
                    };
                    }
                    return {
                    get: jest.fn().mockResolvedValue({ exists: false }),
                    };
                },
                };
            }

            if (col === "events") {
                return {
                add: addEventMock,
                };
            }

            return {
                doc: jest.fn().mockReturnThis(),
                get: jest.fn(),
                set: jest.fn(),
            };
        });

        const res = await request(app)
        .delete(`/users/${userId}`)
        .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(403);
        expect(res.body.error).toBe("Forbidden");
        expect(res.body.message).toBe("Requires one of: admin");
    });
});