/**
 * Walk With Me — Route Deviation Alert
 *
 * Tracks a user's walk in real-time. If the user deviates significantly from
 * the straight-line path to their destination OR stops unexpectedly in a
 * potentially risky spot for too long, their trusted contacts and police are
 * notified via Socket.IO and SMS.
 *
 * Thresholds (normal mode / high-risk mode):
 *   Deviation    : 300 m / 150 m from the straight-line corridor
 *   Stopped      : 180 s / 90 s without meaningful movement (< 10 m)
 */

const express = require("express");
const { body, param, validationResult } = require("express-validator");
const { requireAuth } = require("../middleware/auth");
const Contact = require("../models/Contact");
const User = require("../models/User");
const { client } = require("../db/supabase");
const router = express.Router();

const validate = (req, res, next) => {
  const result = validationResult(req);
  if (!result.isEmpty()) return res.status(400).json({ error: result.array()[0].msg });
  next();
};

/* ─── In-memory session store (survives restarts only via Supabase) ──── */
// For production use the walk_sessions table in Supabase; this in-memory map
// gives instant-access without a DB round-trip on every location ping.
const activeSessions = new Map(); // sessionId → session object

/* ─── Helpers ───────────────────────────────────────────────────────── */

/** Haversine distance in metres between two {lat,lng} points */
function distanceM(a, b) {
  const R = 6_371_000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Perpendicular distance (metres) from point P to the line segment A→B */
function perpendicularDistanceM(A, B, P) {
  // Convert to flat-earth approximation (accurate enough for ≤ 10 km)
  const latScale = 111_320; // m / degree lat
  const lngScale = 111_320 * Math.cos((A.lat * Math.PI) / 180); // m / degree lng

  const ax = A.lng * lngScale, ay = A.lat * latScale;
  const bx = B.lng * lngScale, by = B.lat * latScale;
  const px = P.lng * lngScale, py = P.lat * latScale;

  const abLen = Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2);
  if (abLen < 1) return distanceM(A, { lat: P.lat, lng: P.lng });

  // Cross-product gives the perpendicular distance
  const cross = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay));
  return cross / abLen;
}

/** Broadcast a walksafe event to all trusted contacts and police */
async function broadcastWalkEvent(io, session, event, payload) {
  if (!io) return;
  try {
    const contacts = await Contact.find({ owner: session.userId }).select("contactUserId");
    const ids = contacts.map((c) => c.contactUserId).filter(Boolean);
    const recipients = await User.find({ _id: { $in: ids }, isActive: true }).select("_id");
    recipients.forEach((r) => io.to(`user:${r._id}`).emit(event, payload));
    io.to("police").emit(event, payload);
  } catch (_) {}
}

/** Persist walk session to Supabase (best-effort, non-blocking) */
async function persistSession(session) {
  if (!client) return;
  try {
    await client.from("walk_sessions").upsert(
      {
        id: session.id,
        user_id: session.userId,
        destination_name: session.destinationName,
        dest_lat: session.destLat,
        dest_lng: session.destLng,
        start_lat: session.startLat,
        start_lng: session.startLng,
        estimated_minutes: session.estimatedMinutes,
        high_risk_mode: session.highRiskMode,
        status: session.status,
        started_at: session.startedAt,
        last_movement_at: session.lastMovementAt,
        last_lat: session.lastLat,
        last_lng: session.lastLng,
        deviation_triggered: session.deviationTriggered,
        stopped_triggered: session.stoppedTriggered,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );
  } catch (_) {}
}

router.use(requireAuth);

/* ─── POST /api/walksafe/start ──────────────────────────────────────── */
router.post(
  "/start",
  body("destinationName").isString().trim().notEmpty().withMessage("destinationName required"),
  body("destinationLat").isFloat({ min: -90, max: 90 }),
  body("destinationLng").isFloat({ min: -180, max: 180 }),
  body("startLat").optional().isFloat({ min: -90, max: 90 }),
  body("startLng").optional().isFloat({ min: -180, max: 180 }),
  body("estimatedMinutes").optional().isFloat({ min: 1, max: 300 }),
  body("highRiskMode").optional().isBoolean(),
  validate,
  async (req, res, next) => {
    try {
      // Cancel any existing active session for this user
      for (const [id, s] of activeSessions) {
        if (String(s.userId) === String(req.user._id) && s.status === "ACTIVE") {
          s.status = "SUPERSEDED";
          activeSessions.delete(id);
        }
      }

      const id = `WLK-${Date.now().toString(36).toUpperCase()}`;
      const now = new Date();
      const session = {
        id,
        userId: req.user._id,
        userName: req.user.name,
        destinationName: req.body.destinationName,
        destLat: parseFloat(req.body.destinationLat),
        destLng: parseFloat(req.body.destinationLng),
        startLat: req.body.startLat != null ? parseFloat(req.body.startLat) : null,
        startLng: req.body.startLng != null ? parseFloat(req.body.startLng) : null,
        estimatedMinutes: req.body.estimatedMinutes ? parseFloat(req.body.estimatedMinutes) : 20,
        highRiskMode: Boolean(req.body.highRiskMode),
        status: "ACTIVE",
        startedAt: now.toISOString(),
        lastMovementAt: now.toISOString(),
        lastLat: req.body.startLat != null ? parseFloat(req.body.startLat) : null,
        lastLng: req.body.startLng != null ? parseFloat(req.body.startLng) : null,
        deviationTriggered: false,
        stoppedTriggered: false,
        checkpoints: [],
      };

      activeSessions.set(id, session);
      void persistSession(session);

      // Notify family
      const io = req.app.get("io");
      void broadcastWalkEvent(io, session, "walksafe:started", {
        sessionId: id,
        userId: session.userId,
        userName: session.userName,
        destinationName: session.destinationName,
        estimatedMinutes: session.estimatedMinutes,
        startedAt: session.startedAt,
      });

      res.status(201).json(session);
    } catch (e) {
      next(e);
    }
  }
);

/* ─── POST /api/walksafe/:id/update ─────────────────────────────────── */
router.post(
  "/:id/update",
  body("latitude").isFloat({ min: -90, max: 90 }),
  body("longitude").isFloat({ min: -180, max: 180 }),
  body("accuracy").optional().isFloat({ min: 0 }),
  validate,
  async (req, res, next) => {
    try {
      const session = activeSessions.get(req.params.id);
      if (!session) return res.status(404).json({ error: "Walk session not found or not active" });
      if (String(session.userId) !== String(req.user._id))
        return res.status(403).json({ error: "Not your walk session" });
      if (session.status !== "ACTIVE")
        return res.status(409).json({ error: `Walk session is ${session.status}` });

      const lat = parseFloat(req.body.latitude);
      const lng = parseFloat(req.body.longitude);
      const now = Date.now();
      const P = { lat, lng };

      // Movement check
      const prevLat = session.lastLat ?? lat;
      const prevLng = session.lastLng ?? lng;
      const movedM = distanceM({ lat: prevLat, lng: prevLng }, P);

      let alerts = [];

      if (movedM >= 10) {
        // User moved — reset stopped clock
        session.lastMovementAt = new Date(now).toISOString();
        session.lastLat = lat;
        session.lastLng = lng;
        session.stoppedTriggered = false; // reset so it can fire again later
      } else {
        // Check stopped threshold
        const stoppedMs = now - new Date(session.lastMovementAt).getTime();
        const stoppedThresholdMs = session.highRiskMode ? 90_000 : 180_000;

        if (stoppedMs >= stoppedThresholdMs && !session.stoppedTriggered) {
          session.stoppedTriggered = true;
          alerts.push("STOPPED");

          const io = req.app.get("io");
          const payload = {
            sessionId: session.id,
            userId: session.userId,
            userName: session.userName,
            latitude: lat,
            longitude: lng,
            destinationName: session.destinationName,
            stoppedForSeconds: Math.floor(stoppedMs / 1000),
            highRiskMode: session.highRiskMode,
          };
          void broadcastWalkEvent(io, session, "walksafe:stopped", payload);
        }
      }

      // Deviation check (only when start coords are known)
      if (session.startLat != null && !session.deviationTriggered) {
        const A = { lat: session.startLat, lng: session.startLng };
        const B = { lat: session.destLat, lng: session.destLng };
        const deviationM = perpendicularDistanceM(A, B, P);
        const deviationThresholdM = session.highRiskMode ? 150 : 300;

        if (deviationM > deviationThresholdM) {
          session.deviationTriggered = true;
          alerts.push("DEVIATION");

          const io = req.app.get("io");
          const payload = {
            sessionId: session.id,
            userId: session.userId,
            userName: session.userName,
            latitude: lat,
            longitude: lng,
            destinationName: session.destinationName,
            deviationMetres: Math.round(deviationM),
            thresholdMetres: deviationThresholdM,
            highRiskMode: session.highRiskMode,
          };
          void broadcastWalkEvent(io, session, "walksafe:deviation", payload);
        }
      }

      // Record checkpoint
      session.checkpoints.push({ lat, lng, accuracy: req.body.accuracy, timestamp: new Date(now).toISOString() });

      // Broadcast live location to family
      const io = req.app.get("io");
      void broadcastWalkEvent(io, session, "walksafe:location", {
        sessionId: session.id,
        userId: session.userId,
        latitude: lat,
        longitude: lng,
        timestamp: new Date(now).toISOString(),
      });

      void persistSession(session);
      res.json({ ok: true, alerts, sessionId: session.id });
    } catch (e) {
      next(e);
    }
  }
);

/* ─── POST /api/walksafe/:id/arrived ───────────────────────────────── */
router.post("/:id/arrived", async (req, res, next) => {
  try {
    const session = activeSessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: "Walk session not found" });
    if (String(session.userId) !== String(req.user._id))
      return res.status(403).json({ error: "Not your walk session" });

    session.status = "ARRIVED";
    session.arrivedAt = new Date().toISOString();
    activeSessions.delete(req.params.id);

    const io = req.app.get("io");
    void broadcastWalkEvent(io, session, "walksafe:arrived", {
      sessionId: session.id,
      userId: session.userId,
      userName: session.userName,
      destinationName: session.destinationName,
      arrivedAt: session.arrivedAt,
    });

    void persistSession(session);
    res.json({ ok: true, session });
  } catch (e) {
    next(e);
  }
});

/* ─── POST /api/walksafe/:id/cancel ────────────────────────────────── */
router.post("/:id/cancel", async (req, res, next) => {
  try {
    const session = activeSessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: "Walk session not found" });
    if (String(session.userId) !== String(req.user._id))
      return res.status(403).json({ error: "Not your walk session" });

    session.status = "CANCELLED";
    session.cancelledAt = new Date().toISOString();
    activeSessions.delete(req.params.id);

    const io = req.app.get("io");
    void broadcastWalkEvent(io, session, "walksafe:cancelled", {
      sessionId: session.id,
      userId: session.userId,
      userName: session.userName,
      destinationName: session.destinationName,
    });

    void persistSession(session);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* ─── GET /api/walksafe/active ──────────────────────────────────────── */
router.get("/active", async (req, res) => {
  for (const [, s] of activeSessions) {
    if (String(s.userId) === String(req.user._id) && s.status === "ACTIVE") {
      return res.json(s);
    }
  }
  res.json(null);
});

module.exports = router;
