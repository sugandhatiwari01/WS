const express = require("express");
const { body, param, validationResult } = require("express-validator");
const { requireAuth, requireRole } = require("../middleware/auth");
const Emergency = require("../models/Emergency");
const EmergencyLocation = require("../models/EmergencyLocation");
const EmergencyAudio = require("../models/EmergencyAudio");
const EmergencyEvent = require("../models/EmergencyEvent");
const PoliceStation = require("../models/PoliceStation");
const Contact = require("../models/Contact");
const User = require("../models/User");
const router = express.Router();
const validate = (req, res, next) => { const result = validationResult(req); if (!result.isEmpty()) return res.status(400).json({ error: result.array()[0].msg }); next(); };
const emit = (req, event, item) => req.app.get("io")?.to(`emergency:${item._id}`).emit(event, item);
router.use(requireAuth);

router.post("/", body("level").optional().isIn(["LEVEL_1", "LEVEL_2", "LEVEL_3"]), body("triggerType").optional().isIn(["SOS_BUTTON", "SHAKE", "TIMER", "MANUAL_LEVEL_2", "AUTO_ESCALATION"]), body("latitude").optional().isFloat({ min: -90, max: 90 }), body("longitude").optional().isFloat({ min: -180, max: 180 }), validate, async (req, res, next) => {
  try {
    if (req.user.role !== "user") return res.status(403).json({ error: "Only users can create emergencies" });
    const existing = await Emergency.findOne({ userId: req.user._id, status: { $nin: ["RESOLVED", "CANCELLED", "FALSE_ALARM"] } });
    if (existing) return res.status(409).json({ error: "ACTIVE_EMERGENCY_EXISTS", emergency: existing });
    const point = req.body.latitude != null ? { latitude: Number(req.body.latitude), longitude: Number(req.body.longitude), accuracy: Number(req.body.accuracy || 0) } : undefined;
    let stationId;
    if (point) {
      const station = await PoliceStation.findOne({
        active: true,
        location: { $near: { $geometry: { type: "Point", coordinates: [point.longitude, point.latitude] } } }
      });
      stationId = station?.stationId;
    }
    const emergency = await Emergency.create({ userId: req.user._id, requester: req.user._id, level: req.body.level, triggerType: req.body.triggerType, initialLocation: point, currentLocation: point, stationId, location: point && { lat: point.latitude, lng: point.longitude } });
    await EmergencyEvent.create({ emergencyId: emergency._id, actorId: req.user._id, type: "CREATED", metadata: { stationId } });
    req.app.get("io")?.to(stationId ? `station:${stationId}` : "police").emit("emergency:new", emergency);
    const trustedContacts = await Contact.find({ owner: req.user._id }).select("contactUserId");
    const recipientIds = trustedContacts.map(contact => contact.contactUserId).filter(Boolean);
    const recipients = await User.find({ _id: { $in: recipientIds }, isActive: true }).select("_id");
    recipients.forEach(recipient => req.app.get("io")?.to(`user:${recipient._id}`).emit("family:emergency", { emergencyId: emergency.emergencyId, level: emergency.level, status: emergency.status, startedAt: emergency.startedAt }));
    res.status(201).json(emergency);
  } catch (error) { next(error); }
});
router.get("/history", async (req, res, next) => { try { const query = req.user.role === "user" ? { userId: req.user._id } : {}; res.json(await Emergency.find(query).sort("-createdAt").limit(100)); } catch (e) { next(e); } });
router.get("/:id", async (req, res, next) => { try { const item = await Emergency.findOne({ $or: [{ _id: req.params.id }, { emergencyId: req.params.id }] }); if (!item) return res.status(404).json({ error: "Emergency not found" }); if (req.user.role === "user" && String(item.userId) !== String(req.user._id)) return res.status(403).json({ error: "Not allowed" }); res.json(item); } catch (e) { next(e); } });
router.post("/:id/cancel", async (req, res, next) => { try { const item = await Emergency.findOneAndUpdate({ $or: [{ _id: req.params.id }, { emergencyId: req.params.id }], userId: req.user._id, status: { $nin: ["RESOLVED", "CANCELLED"] } }, { $set: { status: "CANCELLED", cancelledAt: new Date() } }, { new: true }); if (!item) return res.status(404).json({ error: "Emergency not found or already closed" }); await EmergencyEvent.create({ emergencyId: item._id, actorId: req.user._id, type: "CANCELLED" }); emit(req, "emergency:cancelled", item); res.json(item); } catch (e) { next(e); } });
router.post("/:id/escalate", body("level").isIn(["LEVEL_2", "LEVEL_3"]), validate, async (req, res, next) => { try { const item = await Emergency.findOneAndUpdate({ $or: [{ _id: req.params.id }, { emergencyId: req.params.id }], userId: req.user._id, status: { $nin: ["RESOLVED", "CANCELLED"] } }, { $set: { level: req.body.level } }, { new: true }); if (!item) return res.status(404).json({ error: "Emergency not found" }); await EmergencyEvent.create({ emergencyId: item._id, actorId: req.user._id, type: "ESCALATED", metadata: { level: item.level } }); emit(req, "emergency:escalated", item); res.json(item); } catch (e) { next(e); } });
router.post("/:id/location", body("latitude").isFloat({ min: -90, max: 90 }), body("longitude").isFloat({ min: -180, max: 180 }), body("accuracy").optional().isFloat({ min: 0 }), validate, async (req, res, next) => { try { const item = await Emergency.findOne({ $or: [{ _id: req.params.id }, { emergencyId: req.params.id }], userId: req.user._id, status: { $nin: ["RESOLVED", "CANCELLED"] } }); if (!item) return res.status(404).json({ error: "Emergency not found" }); const location = { latitude: +req.body.latitude, longitude: +req.body.longitude, accuracy: +(req.body.accuracy || 0), timestamp: new Date(), speed: req.body.speed, heading: req.body.heading }; item.currentLocation = location; await item.save(); await EmergencyLocation.create({ emergencyId: item._id, ...location }); emit(req, "location:update", location); res.json(location); } catch (e) { next(e); } });
router.post("/:id/audio", body("storageReference").isString().trim().notEmpty(), body("duration").optional().isFloat({ min: 0 }), validate, async (req, res, next) => { try { const item = await Emergency.findOne({ $or: [{ _id: req.params.id }, { emergencyId: req.params.id }], userId: req.user._id }); if (!item) return res.status(404).json({ error: "Emergency not found" }); const audio = await EmergencyAudio.create({ emergencyId: item._id, userId: req.user._id, storageReference: req.body.storageReference, duration: req.body.duration }); res.status(201).json(audio); } catch (e) { next(e); } });
router.get("/:id/audio", requireRole("police", "admin"), async (req, res, next) => { try { const item = await Emergency.findOne({ $or: [{ _id: req.params.id }, { emergencyId: req.params.id }] }); if (!item) return res.status(404).json({ error: "Emergency not found" }); res.json(await EmergencyAudio.find({ emergencyId: item._id })); } catch (e) { next(e); } });
module.exports = router;
