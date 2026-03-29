import request from "supertest";
import { createTestApp, setupMockUser } from "./helpers/setup";

describe("Pagination Integration", () => {
  const app = createTestApp();

  beforeEach(() => {
    setupMockUser("dispatcher-1", "dispatcher");
  });

  test("GET /trips default pagination envelope", async () => {
    const res = await request(app)
      .get("/trips")
      .set("Authorization", "Bearer mock");

    expect(res.status).toBe(200);

    expect(res.body).toHaveProperty("data");
    expect(res.body).toHaveProperty("total");
    expect(res.body).toHaveProperty("page");
    expect(res.body).toHaveProperty("hasMore");

    expect(Array.isArray(res.body.data)).toBe(true);
    expect(typeof res.body.total).toBe("number");
    expect(typeof res.body.page).toBe("number");
    expect(typeof res.body.hasMore).toBe("boolean");
  });

  test("invalid limit returns 400", async () => {
    const res = await request(app)
      .get("/trips?limit=0")
      .set("Authorization", "Bearer mock");

    expect(res.status).toBe(400);
  });

  test("invalid page returns 400", async () => {
    const res = await request(app)
      .get("/trips?page=0")
      .set("Authorization", "Bearer mock");

    expect(res.status).toBe(400);
  });

  test("limit above max returns 400", async () => {
    const res = await request(app)
      .get("/trips?limit=101")
      .set("Authorization", "Bearer mock");

    expect(res.status).toBe(400);
  });

  test("cursor and page together returns 400", async () => {
    const res = await request(app)
      .get("/trips?page=1&cursor=testcursor")
      .set("Authorization", "Bearer mock");

    expect(res.status).toBe(400);
  });

  test("GET /drivers pagination envelope", async () => {
    const res = await request(app)
      .get("/drivers")
      .set("Authorization", "Bearer mock");

    expect(res.status).toBe(200);

    expect(res.body).toHaveProperty("data");
    expect(res.body).toHaveProperty("total");
    expect(res.body).toHaveProperty("page");
    expect(res.body).toHaveProperty("hasMore");
  });

  test("GET /users pagination envelope", async () => {
    const res = await request(app)
      .get("/users")
      .set("Authorization", "Bearer mock");

    expect(res.status).toBe(200);

    expect(res.body).toHaveProperty("data");
    expect(res.body).toHaveProperty("total");
    expect(res.body).toHaveProperty("page");
    expect(res.body).toHaveProperty("hasMore");
  });
});