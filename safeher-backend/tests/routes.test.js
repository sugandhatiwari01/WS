const request = require("supertest");
const { app } = require("../server");

describe("configuration-gated integration routes", () => {
  test("rejects calls when voice service is not configured", async () => {
    const apiKey = process.env.EDESY_API_KEY;
    const agentId = process.env.EDESY_AGENT_ID;
    delete process.env.EDESY_API_KEY;
    delete process.env.EDESY_AGENT_ID;

    const response = await request(app)
      .post("/make-call")
      .send({ to: "+15551234567" });

    if (apiKey === undefined) delete process.env.EDESY_API_KEY;
    else process.env.EDESY_API_KEY = apiKey;
    if (agentId === undefined) delete process.env.EDESY_AGENT_ID;
    else process.env.EDESY_AGENT_ID = agentId;
    expect(response.status).toBe(503);
    expect(response.body.error).toMatch(/not configured/i);
  });

  test("validates SMS input before checking configuration", async () => {
    const response = await request(app)
      .post("/send-sms")
      .send({ phone: "", message: "" });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/required/i);
  });
});
