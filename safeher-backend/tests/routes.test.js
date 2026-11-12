const request = require("supertest");
const { app } = require("../server");

/**
 * Tests for the /api/notify routes.
 *
 * The old unauthenticated /make-call and /send-sms top-level routes have been
 * moved to authenticated /api/notify/fake-call and /api/notify/sos-sms routes.
 * These tests verify the new endpoints return appropriate errors when
 * configuration or auth is missing.
 */
describe("notification routes", () => {
  test("POST /api/notify/fake-call requires authentication", async () => {
    const response = await request(app)
      .post("/api/notify/fake-call")
      .send({ phone: "+15551234567" });

    // 503 when DB not configured; 401 when DB is configured but no token
    expect([401, 503]).toContain(response.status);
  });

  test("POST /api/notify/sos-sms requires authentication", async () => {
    const response = await request(app)
      .post("/api/notify/sos-sms")
      .send({ emergencyId: "EMG-TEST", userName: "Test User" });

    expect([401, 503]).toContain(response.status);
  });

  test("POST /api/notify/sos-cancel requires authentication", async () => {
    const response = await request(app)
      .post("/api/notify/sos-cancel")
      .send({ emergencyId: "EMG-TEST", userName: "Test User" });

    expect([401, 503]).toContain(response.status);
  });
});
