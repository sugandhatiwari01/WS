const express = require("express");
const multer = require("multer");
const { body, param, validationResult } = require("express-validator");
const { requireAuth, requireRole } = require("../middleware/auth");
const Emergency = require("../models/Emergency");
const EmergencyLocation = require("../models/EmergencyLocation");
const EmergencyAudio = require("../models/EmergencyAudio");
const EmergencyPhoto = require("../models/EmergencyPhoto");
const EmergencyEvent = require("../models/EmergencyEvent");
const PoliceStation = require("../models/PoliceStation");
const { findNearestPoliceStation, nearestFromCache } = require("../services/policeStations");
// Shape stored on an incident for the nearest real (OpenStreetMap) police station.
const toNearbyStation = s => s && { stationId: s.stationId, name: s.name, address: s.address || null, phone: s.phone || null, distanceKm: s.distanceKm, location: { type: "Point", coordinates: [s.longitude, s.latitude] }, source: "openstreetmap" };
const Contact = require("../models/Contact");
const User = require("../models/User");
const { client } = require("../db/supabase");
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const validate = (req, res, next) => { const result = validationResult(req); if (!result.isEmpty()) return res.status(400).json({ error: result.array()[0].msg }); next(); };
const emit = (req, event, item) => req.app.get("io")?.to(`emergency:${item._id}`).emit(event, item);
const distanceKm = (from, to) => {
  const radians = value => value * Math.PI / 180;
  const dLat = radians(to.latitude - from.latitude);
  const dLng = radians(to.longitude - from.longitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};
const EVIDENCE_BUCKET = "emergency-audio";
const findEmergency = id => Emergency.findOne({ $or: [{ _id: id }, { emergencyId: id }] });
// Owner, police/responder/admin, or a family member the victim added as a contact.
const canViewEvidence = async (item, user) =>
  String(item.userId) === String(user._id) ||
  ["police", "admin", "responder"].includes(user.role) ||
  Boolean(await Contact.exists({ owner: item.userId, contactUserId: user._id }));
const signedUrl = async storageReference => {
  if (!client) return null;
  try {
    const { data } = await client.storage.from(EVIDENCE_BUCKET).createSignedUrl(storageReference, 86400);
    return data?.signedUrl || null;
  } catch (_) { return null; }
};
// Sends an evidence event to the incident room, police, and the victim's linked family contacts.
const broadcastEvidence = async (req, item, event, payload) => {
  const io = req.app.get("io");
  if (!io) return;
  io.to(`emergency:${item._id}`).emit(event, payload);
  if (item.stationId) io.to(`station:${item.stationId}`).emit(event, payload);
  io.to("police").emit(event, payload);
  const userContacts = await Contact.find({ owner: item.userId }).select("contactUserId");
  userContacts.map(c => c.contactUserId).filter(Boolean).forEach(uid => io.to(`user:${uid}`).emit(event, payload));
};
const AUDIO_TYPES = { m4a: "audio/mp4", mp4: "audio/mp4", aac: "audio/aac", "3gp": "audio/3gpp", webm: "audio/webm", ogg: "audio/ogg", wav: "audio/wav", caf: "audio/x-caf" };
const audioContentType = file => {
  if (file.mimetype?.startsWith("audio/")) return file.mimetype;
  const ext = (file.originalname || "").split(".").pop()?.toLowerCase();
  return AUDIO_TYPES[ext] || "audio/mp4";
};
// Phones that cannot send multipart uploads send { fileBase64, filename } as JSON instead.
const fileFromRequest = req => {
  if (req.file) return req.file;
  if (typeof req.body?.fileBase64 !== "string" || !req.body.fileBase64) return null;
  const buffer = Buffer.from(req.body.fileBase64, "base64");
  if (!buffer.length || buffer.length > 10 * 1024 * 1024) return null;
  return { buffer, originalname: typeof req.body.filename === "string" ? req.body.filename : "", mimetype: "" };
};
router.use(requireAuth);

router.get("/active", async (req, res, next) => {
  try {
    const emergency = await Emergency.findOne({
      userId: req.user._id,
      status: { $nin: ["RESOLVED", "CANCELLED", "FALSE_ALARM"] }
    });
    res.json(emergency);
  } catch (error) {
    next(error);
  }
});

router.post("/", body("level").optional().isIn(["LEVEL_1", "LEVEL_2", "LEVEL_3"]), body("triggerType").optional().isIn(["SOS_BUTTON", "SHAKE", "TIMER", "MANUAL_LEVEL_2", "AUTO_ESCALATION"]), body("latitude").optional().isFloat({ min: -90, max: 90 }), body("longitude").optional().isFloat({ min: -180, max: 180 }), validate, async (req, res, next) => {
  try {
    if (req.user.role !== "user") return res.status(403).json({ error: "Only users can create emergencies" });
    const existing = await Emergency.findOne({ userId: req.user._id, status: { $nin: ["RESOLVED", "CANCELLED", "FALSE_ALARM"] } });
    if (existing) return res.json({ ...existing, alreadyActive: true });
    const point = req.body.latitude != null ? { latitude: Number(req.body.latitude), longitude: Number(req.body.longitude), accuracy: Number(req.body.accuracy || 0) } : undefined;
    let stationId;
    let nearbyStation;
    if (point) {
      const stations = await PoliceStation.find({ active: true });
      const nearest = stations
        .map(station => ({ station, distanceKm: distanceKm(point, { latitude: station.location?.coordinates?.[1], longitude: station.location?.coordinates?.[0] }) }))
        .filter(item => Number.isFinite(item.distanceKm) && item.distanceKm <= 10)
        .sort((a, b) => a.distanceKm - b.distanceKm)[0];
      stationId = nearest?.station.stationId;
      // The registered SafeHer station (stationId) decides which officers are alerted; the station shown
      // to the victim and police is the nearest real one from OpenStreetMap.
      nearbyStation = toNearbyStation(nearestFromCache(point.latitude, point.longitude));
    }
    const emergency = await Emergency.create({ userId: req.user._id, requester: req.user._id, level: req.body.level, triggerType: req.body.triggerType, initialLocation: point, currentLocation: point, stationId, nearbyStation, location: point && { lat: point.latitude, lng: point.longitude } });
    await EmergencyEvent.create({ emergencyId: emergency._id, actorId: req.user._id, type: "CREATED", metadata: { stationId } });
    req.app.get("io")?.to(stationId ? `station:${stationId}` : "police").emit("emergency:new", emergency);
    const trustedContacts = await Contact.find({ owner: req.user._id }).select("contactUserId");
    const recipientIds = trustedContacts.map(contact => contact.contactUserId).filter(Boolean);
    const recipients = await User.find({ _id: { $in: recipientIds }, isActive: true }).select("_id");
    recipients.forEach(recipient => req.app.get("io")?.to(`user:${recipient._id}`).emit("family:emergency", { emergencyId: emergency.emergencyId, level: emergency.level, status: emergency.status, startedAt: emergency.startedAt }));
    res.status(201).json(emergency);
    // Area not cached yet: look the real station up without delaying the SOS response.
    if (point && !nearbyStation) {
      findNearestPoliceStation(point.latitude, point.longitude).then(async real => {
        if (!real) return;
        const updated = await Emergency.findOneAndUpdate({ _id: emergency._id }, { $set: { nearbyStation: toNearbyStation(real) } }, { new: true });
        if (updated) req.app.get("io")?.to("police").emit("emergency:updated", updated);
      }).catch(error => console.warn("[nearby station lookup]", error.message));
    }
  } catch (error) { next(error); }
});
router.get("/history", async (req, res, next) => { try { const query = req.user.role === "user" ? { userId: req.user._id } : {}; res.json(await Emergency.find(query).sort("-createdAt").limit(100)); } catch (e) { next(e); } });
router.get("/:id", async (req, res, next) => {
  try {
    const item = await findEmergency(req.params.id);
    if (!item) return res.status(404).json({ error: "Emergency not found" });
    if (!(await canViewEvidence(item, req.user))) return res.status(403).json({ error: "Not allowed" });
    res.json(item);
  } catch (e) { next(e); }
});
router.post("/:id/cancel", async (req, res, next) => { try { const item = await Emergency.findOneAndUpdate({ $or: [{ _id: req.params.id }, { emergencyId: req.params.id }], userId: req.user._id, status: { $nin: ["RESOLVED", "CANCELLED"] } }, { $set: { status: "CANCELLED", cancelledAt: new Date() } }, { new: true }); if (!item) return res.status(404).json({ error: "Emergency not found or already closed" }); await EmergencyEvent.create({ emergencyId: item._id, actorId: req.user._id, type: "CANCELLED" }); emit(req, "emergency:cancelled", item); res.json(item); } catch (e) { next(e); } });
router.post("/:id/escalate", body("level").isIn(["LEVEL_2", "LEVEL_3"]), validate, async (req, res, next) => { try { const item = await Emergency.findOneAndUpdate({ $or: [{ _id: req.params.id }, { emergencyId: req.params.id }], userId: req.user._id, status: { $nin: ["RESOLVED", "CANCELLED"] } }, { $set: { level: req.body.level } }, { new: true }); if (!item) return res.status(404).json({ error: "Emergency not found" }); await EmergencyEvent.create({ emergencyId: item._id, actorId: req.user._id, type: "ESCALATED", metadata: { level: item.level } }); emit(req, "emergency:escalated", item); res.json(item); } catch (e) { next(e); } });
router.post("/:id/location", body("latitude").isFloat({ min: -90, max: 90 }), body("longitude").isFloat({ min: -180, max: 180 }), body("accuracy").optional().isFloat({ min: 0 }), validate, async (req, res, next) => {
  try {
    const item = await Emergency.findOne({ $or: [{ _id: req.params.id }, { emergencyId: req.params.id }], userId: req.user._id, status: { $nin: ["RESOLVED", "CANCELLED"] } });
    if (!item) return res.status(404).json({ error: "Emergency not found" });
    const location = { latitude: +req.body.latitude, longitude: +req.body.longitude, accuracy: +(req.body.accuracy || 0), timestamp: new Date(), speed: req.body.speed, heading: req.body.heading };
    item.currentLocation = location;
    await item.save();
    await EmergencyLocation.create({ emergencyId: item._id, ...location });

    // Emit live location updates
    const io = req.app.get("io");
    if (io) {
      const livePayload = { emergencyId: item._id, ...location, userId: item.userId };
      io.to(`emergency:${item._id}`).emit("location:live", livePayload);
      io.to(`emergency:${item._id}`).emit("location:update", location);

      // Broadcast to police station and general police
      if (item.stationId) io.to(`station:${item.stationId}`).emit("location:live", livePayload);
      io.to("police").emit("location:live", livePayload);

      // Broadcast to all linked family contacts
      const userContacts = await Contact.find({ owner: item.userId }).select("contactUserId");
      const contactUserIds = userContacts.map((c) => c.contactUserId).filter(Boolean);
      contactUserIds.forEach((uid) => {
        io.to(`user:${uid}`).emit("location:live", livePayload);
      });
    }

    res.json(location);
  } catch (e) { next(e); }
});
router.post("/:id/audio", upload.single("audio"), body("storageReference").optional().isString().trim(), body("duration").optional().isFloat({ min: 0 }), validate, async (req, res, next) => { try {
  const item = await findEmergency(req.params.id);
  if (!item) return res.status(404).json({ error: "Emergency not found" });
  const allowed = req.user.role === "admin" || req.user.role === "police" || req.user.role === "responder" || String(item.userId) === String(req.user._id);
  if (!allowed) return res.status(403).json({ error: "Not allowed" });
  let storageReference = req.body.storageReference;
  const file = fileFromRequest(req);
  if (file) {
    const safeName = file.originalname ? file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_") : `evidence-${Date.now()}.m4a`;
    const path = `${item._id}/${Date.now()}-${safeName}`;
    if (client) {
      const { error } = await client.storage.from(EVIDENCE_BUCKET).upload(path, file.buffer, { contentType: audioContentType(file), upsert: true });
      if (error) {
        console.error("[Supabase Audio Upload Error]:", error);
        return res.status(500).json({ error: `Audio upload failed: ${error.message}` });
      }
    }
    storageReference = path;
  }
  if (!storageReference) return res.status(400).json({ error: "An audio file or storage reference is required" });
  const audio = await EmergencyAudio.create({ emergencyId: item._id, userId: req.user._id, storageReference, duration: req.body.duration });
  const url = await signedUrl(storageReference);
  await broadcastEvidence(req, item, "audio:evidence", { emergencyId: item._id, audioId: audio._id, storageReference, url, duration: req.body.duration || 10, createdAt: audio.createdAt });
  res.status(201).json({ ...audio.toJSON(), url });
} catch (e) { next(e); } });
router.get("/:id/audio", async (req, res, next) => {
  try {
    const item = await findEmergency(req.params.id);
    if (!item) return res.status(404).json({ error: "Emergency not found" });
    if (!(await canViewEvidence(item, req.user))) {
      return res.status(403).json({ error: "Insufficient permissions to access audio evidence for this emergency" });
    }
    const audio = await EmergencyAudio.find({ emergencyId: item._id });
    res.json(await Promise.all(audio.map(async recording => ({ ...recording, url: await signedUrl(recording.storageReference) }))));
  } catch (e) {
    next(e);
  }
});

/** POST /:id/photos — the victim's phone uploads a photo taken during an active SOS. */
router.post("/:id/photos", upload.single("photo"), async (req, res, next) => {
  try {
    const item = await findEmergency(req.params.id);
    if (!item) return res.status(404).json({ error: "Emergency not found" });
    if (String(item.userId) !== String(req.user._id)) return res.status(403).json({ error: "Only the person who started the SOS can add photos" });
    if (["RESOLVED", "CANCELLED", "FALSE_ALARM"].includes(item.status)) return res.status(409).json({ error: "This SOS is no longer active" });
    const file = fileFromRequest(req);
    if (!file) return res.status(400).json({ error: "A photo file is required" });
    const contentType = file.mimetype?.startsWith("image/") ? file.mimetype : "image/jpeg";
    const storageReference = `${item._id}/photos/${Date.now()}.${contentType === "image/png" ? "png" : "jpg"}`;
    if (client) {
      const { error } = await client.storage.from(EVIDENCE_BUCKET).upload(storageReference, file.buffer, { contentType, upsert: true });
      if (error) {
        console.error("[Supabase Photo Upload Error]:", error);
        return res.status(500).json({ error: `Photo upload failed: ${error.message}` });
      }
    }
    const takenAt = new Date();
    const photo = await EmergencyPhoto.create({ emergencyId: item._id, userId: req.user._id, storageReference, takenAt, latitude: item.currentLocation?.latitude, longitude: item.currentLocation?.longitude });
    const url = await signedUrl(storageReference);
    await broadcastEvidence(req, item, "photo:evidence", { emergencyId: item._id, photoId: photo._id, url, takenAt });
    res.status(201).json({ ...photo.toJSON(), url });
  } catch (e) { next(e); }
});

/** GET /:id/photos — photos for an incident, oldest first, with 24h signed URLs. */
router.get("/:id/photos", async (req, res, next) => {
  try {
    const item = await findEmergency(req.params.id);
    if (!item) return res.status(404).json({ error: "Emergency not found" });
    if (!(await canViewEvidence(item, req.user))) return res.status(403).json({ error: "Insufficient permissions to view photos for this emergency" });
    const photos = await EmergencyPhoto.find({ emergencyId: item._id }).sort("takenAt");
    res.json(await Promise.all(photos.map(async photo => ({ ...photo, url: await signedUrl(photo.storageReference) }))));
  } catch (e) { next(e); }
});
module.exports = router;
