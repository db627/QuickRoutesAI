import request from "supertest";
import { createTestApp } from "./helpers/setup";

const app = createTestApp();

describe("GET /health", () => {
  it("returns ok status", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, service: "QuickRoutesAI API" });
  });
});
