const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const auth = require("./routes/auth");
const emergencies = require("./routes/emergencies");
const contacts = require("./routes/contacts");
const police = require("./routes/police");
const notify = require("./routes/notify");
const users = require("./routes/users");
const { notFound, errorHandler } = require("./middleware/errors");
const { isConfigured } = require("./db/supabase");

const app = express();

/* ─── Security + parsing ─────────────────────────────────── */
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json({ limit: "100kb" }));
app.use(morgan("combined"));
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 400,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

/* ─── Health check ───────────────────────────────────────── */
app.get("/health", (req, res) =>
  res.json({
    ok: true,
    service: "safeher-backend",
    time: new Date().toISOString(),
    database: isConfigured ? "configured" : "not configured",
    sms: Boolean(process.env.FAST2SMS_API_KEY),
    voice: Boolean(process.env.EDESY_API_KEY && process.env.EDESY_AGENT_ID),
  })
);

/* ─── Database guard ─────────────────────────────────────── */
const requireDatabase = (req, res, next) => {
  if (isConfigured) return next();
  return res.status(503).json({
    error: "DATABASE_UNAVAILABLE",
    message: "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
  });
};

/* ─── API routes ─────────────────────────────────────────── */
app.use("/api", requireDatabase);
app.use("/api/auth", auth);
app.use("/api/emergencies", emergencies);
app.use("/api/contacts", contacts);
app.use("/api/family", contacts);    // /api/family/emergencies alias
app.use("/api/police", police);
app.use("/api/notify", notify);
app.use("/api/users", users);

/* ─── Legacy path aliases (keep for backwards compat) ───── */
app.use("/auth", auth);
app.use("/emergencies", emergencies);
app.use("/contacts", contacts);
app.use("/police", police);

/* ─── Error handling ─────────────────────────────────────── */
app.use(notFound);
app.use(errorHandler);

module.exports = app;
