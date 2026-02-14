import request from "supertest";
import express from "express";
import { validate } from "../../middleware/validate";
import { locationPingSchema } from "@quickroutesai/shared";

function createValidationApp() {
  const app = express();
  app.use(express.json());
  app.post("/test", validate(locationPingSchema), (_req, res) => {
    res.json({ ok: true, body: _req.body });
  });
  return app;
}

describe("validate middleware", () => {
  const app = createValidationApp();

  it("passes valid data through", async () => {
    const res = await request(app)
      .post("/test")
      .send({ lat: 40.7128, lng: -74.006, speedMps: 10, heading: 180 });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.body.lat).toBe(40.7128);
  });

  it("applies defaults for optional fields", async () => {
    const res = await request(app)
      .post("/test")
      .send({ lat: 40.7128, lng: -74.006 });

    expect(res.status).toBe(200);
    expect(res.body.body.speedMps).toBe(0);
    expect(res.body.body.heading).toBe(0);
  });

  it("rejects invalid lat (out of range)", async () => {
    const res = await request(app)
      .post("/test")
      .send({ lat: 200, lng: -74.006 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation Error");
    expect(res.body.details).toBeDefined();
    expect(res.body.details.length).toBeGreaterThan(0);
  });

  it("rejects invalid lng (out of range)", async () => {
    const res = await request(app)
      .post("/test")
      .send({ lat: 40, lng: -200 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation Error");
  });

  it("rejects missing required fields", async () => {
    const res = await request(app)
      .post("/test")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.details.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects non-numeric lat", async () => {
    const res = await request(app)
      .post("/test")
      .send({ lat: "not-a-number", lng: -74.006 });

    expect(res.status).toBe(400);
  });
});
