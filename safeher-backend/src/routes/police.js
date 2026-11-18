const express = require("express");
const multer = require("multer");
const { body, query, validationResult } = require("express-validator");
const { requireAuth, requireRole } = require("../middleware/auth");
const Emergency = require("../models/Emergency");
const EmergencyEvent = require("../models/EmergencyEvent");
const CrimeReport = require("../models/CrimeReport");
const { client } = require("../db/supabase");
const { findNearbyPoliceStations, findNearestPoliceStation, MAX_RADIUS_KM } = require("../services/policeStations");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit for photo proof
});

const validate = (req, res, next) => {
  const result = validationResult(req);
  if (!result.isEmpty()) return res.status(400).json({ error: result.array()[0].msg });
  next();
};

const findIncident = (id) => ({ $or: [{ _id: id }, { emergencyId: id }] });
const findReport = (id) => ({ $or: [{ _id: id }, { reportId: id }] });

// All endpoints require valid JWT authentication
router.use(requireAuth);

/* ──────────────────────────────────────────────────────────────────────────
   1. POLICE STATIONS & NEARBY DIRECTORY (Accessible to ALL users & police)
   ────────────────────────────────────────────────────────────────────────── */
/**
 * GET /api/police/stations?latitude=&longitude=&radiusKm=
 * Real police stations from OpenStreetMap within radiusKm (default 10, max 22), nearest first.
 * Phone numbers are included only when OpenStreetMap lists one — nothing is made up.
 */
router.get(
  "/stations",
  query("latitude").isFloat({ min: -90, max: 90 }).withMessage("latitude is required"),
  query("longitude").isFloat({ min: -180, max: 180 }).withMessage("longitude is required"),
  query("radiusKm").optional().isFloat({ min: 0.5, max: MAX_RADIUS_KM }),
  validate,
  async (req, res, next) => {
    try {
      const { stations, provider, radiusKm, coveredKm } = await findNearbyPoliceStations(
        Number(req.query.latitude),
        Number(req.query.longitude),
        req.query.radiusKm ? Number(req.query.radiusKm) : 10
      );
      res.set("X-Station-Source", `openstreetmap-${provider}`);
      res.set("X-Station-Radius-Km", String(radiusKm));
      res.set("X-Station-Covered-Km", String(coveredKm));
      res.json(stations);
    } catch (e) {
      if (e.status === 503) return res.status(503).json({ error: e.message });
      next(e);
    }
  }
);

/* ──────────────────────────────────────────────────────────────────────────
   2. CRIME REPORTING (CONFIDENTIAL IN-APP REPORTING DIRECT TO POLICE)
   ────────────────────────────────────────────────────────────────────────── */

// User uploads proof photo for crime report
router.post("/reports/upload", upload.single("photo"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No photo file provided." });
    }

    const safeName = req.file.originalname
      ? req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")
      : `proof-${Date.now()}.jpg`;
    const storagePath = `crime-reports/${req.user._id}/${Date.now()}-${safeName}`;
    const contentType = req.file.mimetype || "image/jpeg";

    let photoUrl = null;

    if (client) {
      const { error } = await client.storage
        .from("emergency-audio")
        .upload(storagePath, req.file.buffer, { contentType, upsert: true });

      if (error) {
        console.warn("[Supabase Storage Warning]:", error.message);
      } else {
        const { data: signedData } = await client.storage
          .from("emergency-audio")
          .createSignedUrl(storagePath, 86400 * 30); // 30 days access
        photoUrl = signedData?.signedUrl || null;
      }
    }

    // Fallback: If cloud storage not configured, return base64 data URL
    if (!photoUrl) {
      photoUrl = `data:${contentType};base64,${req.file.buffer.toString("base64")}`;
    }

    res.status(201).json({
      ok: true,
      photoUrl,
      storageReference: storagePath,
    });
  } catch (e) {
    next(e);
  }
});

// User submits confidential crime report directly to police (NOT to family contacts)
router.post(
  "/reports",
  body("crimeType").isString().trim().notEmpty().withMessage("Crime category is required"),
  body("description").isString().trim().notEmpty().withMessage("Incident details are required"),
  body("latitude").optional().isFloat({ min: -90, max: 90 }),
  body("longitude").optional().isFloat({ min: -180, max: 180 }),
  body("address").optional().isString().trim(),
  body("photoUrl").optional().isString(),
  body("storageReference").optional().isString(),
  body("priority").optional().isIn(["HIGH", "MEDIUM", "LOW"]),
  validate,
  async (req, res, next) => {
    try {
      const lat = req.body.latitude != null ? parseFloat(req.body.latitude) : null;
      const lng = req.body.longitude != null ? parseFloat(req.body.longitude) : null;

      // Find nearest station
      // Nearest real (OpenStreetMap) police station within 20 km, if one is listed.
      let nearestStation = null;
      if (lat != null && lng != null) {
        const real = await findNearestPoliceStation(lat, lng, 20);
        if (real) nearestStation = { stationId: real.stationId, name: real.name, distance: real.distanceKm };
      }

      const reportData = {
        userId: req.user._id,
        userName: req.user.name || "Anonymous Citizen",
        userPhone: req.user.phone || null,
        crimeType: req.body.crimeType,
        description: req.body.description,
        location: {
          latitude: lat,
          longitude: lng,
          address: req.body.address || "Current Location Tagged",
        },
        photoUrl: req.body.photoUrl || null,
        storageReference: req.body.storageReference || null,
        priority: req.body.priority || "HIGH",
        status: "SUBMITTED",
        stationId: nearestStation?.stationId || null,
        nearestStationName: nearestStation?.name || null,
        stationDistanceKm: nearestStation?.distance != null ? nearestStation.distance : null,
      };

      const report = await CrimeReport.create(reportData);

      // Notify Police Dashboard in real-time via Socket.IO
      const io = req.app.get("io");
      if (io) {
        io.to("police").emit("crime:new", report);
        if (nearestStation?.stationId) {
          io.to(`station:${nearestStation.stationId}`).emit("crime:new", report);
        }
      }

      res.status(201).json(report);
    } catch (e) {
      next(e);
    }
  }
);

// User views their own submitted crime reports
router.get("/reports/my", async (req, res, next) => {
  try {
    const reports = await CrimeReport.find({ userId: req.user._id }).sort("-createdAt");
    res.json(reports);
  } catch (e) {
    next(e);
  }
});

/* ──────────────────────────────────────────────────────────────────────────
   3. POLICE DISPATCH & OFFICER ACTIONS (Requires police / responder / admin)
   ────────────────────────────────────────────────────────────────────────── */

// View all crime reports on police dashboard
router.get("/reports", requireRole("police", "responder", "admin"), async (req, res, next) => {
  try {
    const queryFilter = {};
    if (req.query.status) {
      queryFilter.status = req.query.status;
    }
    const reports = await CrimeReport.find(queryFilter).sort("-createdAt");
    res.json(reports);
  } catch (e) {
    next(e);
  }
});

// Police officer updates status of a crime report (e.g. INVESTIGATING, ACTION_TAKEN, CLOSED)
router.patch(
  "/reports/:id/status",
  requireRole("police", "responder", "admin"),
  body("status")
    .isIn(["SUBMITTED", "INVESTIGATING", "ACTION_TAKEN", "CLOSED"])
    .withMessage("Invalid status"),
  body("policeNotes").optional().isString().trim(),
  validate,
  async (req, res, next) => {
    try {
      const updateData = {
        status: req.body.status,
        assignedOfficerId: req.user._id,
        officerName: req.user.name,
        updatedAt: new Date(),
      };
      if (req.body.policeNotes !== undefined) {
        updateData.policeNotes = req.body.policeNotes;
      }

      const report = await CrimeReport.findOneAndUpdate(
        findReport(req.params.id),
        { $set: updateData },
        { new: true }
      );

      if (!report) {
        return res.status(404).json({ error: "Crime report not found" });
      }

      // Notify reporting citizen and other police officers in real-time
      const io = req.app.get("io");
      if (io) {
        io.to(`user:${report.userId}`).emit("crime:updated", report);
        io.to("police").emit("crime:updated", report);
      }

      res.json(report);
    } catch (e) {
      next(e);
    }
  }
);

/* ──────────────────────────────────────────────────────────────────────────
   4. EMERGENCY DISPATCH QUEUE (Police responder workflow)
   ────────────────────────────────────────────────────────────────────────── */

router.get("/incidents", requireRole("police", "responder", "admin"), async (req, res, next) => {
  try {
    const incidents = await Emergency.find({
      status: { $nin: ["RESOLVED", "CANCELLED", "FALSE_ALARM"] },
    }).sort({ level: -1, createdAt: 1 });
    res.json(incidents);
  } catch (e) {
    next(e);
  }
});

router.get("/incidents/:id", requireRole("police", "responder", "admin"), async (req, res, next) => {
  try {
    const item = await Emergency.findOne(findIncident(req.params.id));
    if (!item) return res.status(404).json({ error: "Incident not found" });
    res.json(item);
  } catch (e) {
    next(e);
  }
});

router.post("/incidents/:id/claim", requireRole("police", "responder", "admin"), async (req, res, next) => {
  try {
    const item = await Emergency.findOneAndUpdate(
      {
        ...findIncident(req.params.id),
        assignedOfficerId: null,
        status: { $in: ["CREATED", "DISPATCHED", "VIEWED"] },
      },
      {
        $set: {
          assignedOfficerId: req.user._id,
          responder: req.user._id,
          status: "ASSIGNED",
          claimedAt: new Date(),
        },
      },
      { new: true }
    );
    if (!item) return res.status(409).json({ error: "CASE_ALREADY_CLAIMED" });
    await EmergencyEvent.create({ emergencyId: item._id, actorId: req.user._id, type: "CLAIMED" });
    req.app.get("io")?.to(`emergency:${item._id}`).emit("incident:claimed", item);
    req.app.get("io")?.to("police").emit("incident:claimed", item);
    res.json(item);
  } catch (e) {
    next(e);
  }
});

const transition = (from, to) => async (req, res, next) => {
  try {
    const item = await Emergency.findOneAndUpdate(
      { ...findIncident(req.params.id), assignedOfficerId: req.user._id, status: from },
      { $set: { status: to, ...(to === "RESOLVED" ? { resolvedAt: new Date() } : {}) } },
      { new: true }
    );
    if (!item) return res.status(409).json({ error: "INVALID_STATE_TRANSITION" });
    await EmergencyEvent.create({ emergencyId: item._id, actorId: req.user._id, type: to });
    req.app.get("io")?.to(`emergency:${item._id}`).emit(`incident:${to.toLowerCase().replace("_", "-")}`, item);
    req.app.get("io")?.to("police").emit(`incident:${to.toLowerCase().replace("_", "-")}`, item);
    res.json(item);
  } catch (e) {
    next(e);
  }
};

router.post("/incidents/:id/respond", requireRole("police", "responder", "admin"), transition("ASSIGNED", "RESPONDING"));
router.post("/incidents/:id/on-scene", requireRole("police", "responder", "admin"), transition("RESPONDING", "ON_SCENE"));
router.post("/incidents/:id/resolve", requireRole("police", "responder", "admin"), transition("ON_SCENE", "RESOLVED"));

module.exports = router;
