const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const { body, validationResult } = require("express-validator");
const auth = require("./routes/auth");
const emergencies = require("./routes/emergencies");
const contacts = require("./routes/contacts");
const police = require("./routes/police");
const users = require("./routes/users");
const { notFound, errorHandler } = require("./middleware/errors");
const { isConfigured } = require("./db/supabase");

const app = express();
const requireDatabase = (req, res, next) => {
  if (isConfigured) return next();
  return res.status(503).json({
    error: "DATABASE_UNAVAILABLE",
    message: "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
  });
};
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json({ limit: "100kb" }));
app.use(morgan("combined"));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));

app.get("/health", (req, res) => res.json({
  ok: true,
  service: "safeher-backend",
  time: new Date().toISOString()
}));

app.post("/make-call", body("to").isString().trim().notEmpty(), async (req, res, next) => {
  try {
    if (!validationResult(req).isEmpty()) return res.status(400).json({ error: "A destination phone number is required" });
    if (!process.env.EDESY_API_KEY || !process.env.EDESY_AGENT_ID) return res.status(503).json({ error: "Voice service is not configured" });
    const response = await fetch("https://voice-agent.edesy.in/api/v1/calls", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.EDESY_API_KEY}`
      },
      body: JSON.stringify({ phoneNumber: req.body.to, agentId: process.env.EDESY_AGENT_ID })
    });
    const data = await response.json();
    res.status(response.ok ? 200 : response.status).json(data);
  } catch (error) {
    next(error);
  }
});

app.post(
  "/send-sms",
  body("phone").isString().trim().notEmpty(),
  body("message").isString().trim().isLength({ min: 1, max: 1000 }),
  async (req, res, next) => {
    try {
      if (!validationResult(req).isEmpty()) return res.status(400).json({ error: "Phone and message are required" });
      if (!process.env.FAST2SMS_API_KEY) return res.status(503).json({ error: "SMS service is not configured" });
      const query = new URLSearchParams({
        authorization: process.env.FAST2SMS_API_KEY,
        route: "q",
        message: req.body.message,
        language: "english",
        flash: "0",
        numbers: req.body.phone
      });
      const response = await fetch(`https://www.fast2sms.com/dev/bulkV2?${query}`, { method: "GET" });
      const data = await response.json();
      res.status(response.ok ? 200 : response.status).json(data);
    } catch (error) {
      next(error);
    }
  }
);

app.use("/api", requireDatabase);
app.use("/api/auth", auth);
app.use("/api/emergencies", emergencies);
app.use("/api/contacts", contacts);
app.use("/api/family", contacts);
app.use("/api/police", police);
app.use("/api/users", users);
app.use("/auth", auth);
app.use("/emergencies", emergencies);
app.use("/contacts", contacts);
app.use("/police", police);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
