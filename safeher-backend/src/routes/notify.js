/**
 * /api/notify — outbound notification service
 *
 * POST /api/notify/sos-sms     Send SOS SMS to all phone contacts + in-app socket events
 * POST /api/notify/sos-cancel  Send "all clear" SMS to contacts
 * POST /api/notify/ride-sms    Share cab details with trusted phone contacts
 * POST /api/notify/fake-call   Trigger a fake incoming call (Edesy voice agent)
 */

const express = require("express");
const { body, validationResult } = require("express-validator");
const { requireAuth, requireRole } = require("../middleware/auth");
const Contact = require("../models/Contact");
const User = require("../models/User");

const router = express.Router();
router.use(requireAuth);

const validate = (req, res, next) => {
  const errors = validationResult(req);
  return errors.isEmpty() ? next() : res.status(400).json({ error: errors.array()[0].msg });
};

/* ─── helpers ─────────────────────────────────────────────────── */

async function sendSms(phone, message) {
  if (!process.env.FAST2SMS_API_KEY) return { ok: false, reason: "SMS_NOT_CONFIGURED" };
  try {
    const params = new URLSearchParams({
      authorization: process.env.FAST2SMS_API_KEY,
      route: "q",
      message,
      language: "english",
      flash: "0",
      numbers: phone,
    });
    const response = await fetch(`https://www.fast2sms.com/dev/bulkV2?${params}`, { method: "GET" });
    const data = await response.json();
    return { ok: response.ok, data };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

async function triggerFakeCall(phone) {
  if (process.env.EDESY_API_KEY && process.env.EDESY_AGENT_ID) {
    try {
      const response = await fetch("https://voice-agent.edesy.in/api/v1/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.EDESY_API_KEY}` },
        body: JSON.stringify({ phoneNumber: phone, agentId: process.env.EDESY_AGENT_ID }),
      });
      const data = await response.json();
      return { ok: response.ok, simulated: false, data };
    } catch (error) {
      return { ok: false, reason: error.message };
    }
  }

  // Simulated fallback so the user always has a functioning escape call
  return {
    ok: true,
    simulated: true,
    message: "Fake call initiated. Ringing simulated on device.",
  };
}

/* ─── routes ──────────────────────────────────────────────────── */

/**
 * POST /api/notify/sos-sms
 * Body: { emergencyId, latitude?, longitude?, userName }
 *
 * 1. Fetches all contacts of the authenticated user
 * 2. Sends SMS to phone_only contacts and to app_user contacts who have a phone
 * 3. Emits Socket.IO event to in-app contacts
 */
router.post(
  "/sos-sms",
  requireRole("user"),
  body("emergencyId").isString().trim().notEmpty(),
  body("userName").isString().trim().notEmpty(),
  body("latitude").optional().isFloat({ min: -90, max: 90 }),
  body("longitude").optional().isFloat({ min: -180, max: 180 }),
  validate,
  async (req, res, next) => {
    try {
      const { emergencyId, userName, latitude, longitude } = req.body;
      const locationStr =
        latitude != null && longitude != null
          ? `https://maps.google.com/?q=${latitude},${longitude}`
          : "Location unavailable";

      const message =
        `⚠️ EMERGENCY ALERT: ${userName} has triggered an SOS via SafeHer!\n` +
        `📍 Location: ${locationStr}\n` +
        `Emergency ID: ${emergencyId}\n` +
        `Please check on them immediately or call emergency services (112).`;

      // Fetch all contacts for this user
      const contacts = await Contact.find({ owner: req.user._id });

      const smsResults = [];
      const socketRecipients = [];

      for (const contact of contacts) {
        // Send SMS if phone number is available
        if (contact.phone) {
          const result = await sendSms(contact.phone, message);
          smsResults.push({ name: contact.name, phone: contact.phone, ...result });
        }
        // Queue socket notification for in-app users
        if (contact.contactUserId) {
          socketRecipients.push(contact.contactUserId);
        }
      }

      // Emit Socket.IO events to in-app contacts
      const io = req.app.get("io");
      if (io) {
        const registeredContacts = await User.find({ _id: { $in: socketRecipients }, isActive: true }).select("_id");
        registeredContacts.forEach((user) => {
          io.to(`user:${user._id}`).emit("family:emergency", {
            emergencyId,
            level: "LEVEL_1",
            status: "CREATED",
            startedAt: new Date().toISOString(),
            userName,
            location: latitude != null ? { latitude, longitude } : null,
          });
        });
      }

      res.json({
        sent: smsResults.length,
        smsConfigured: Boolean(process.env.FAST2SMS_API_KEY),
        results: smsResults,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/notify/sos-cancel
 * Body: { emergencyId, userName }
 * Sends "all clear" SMS to all contacts.
 */
router.post(
  "/sos-cancel",
  requireRole("user"),
  body("emergencyId").isString().trim().notEmpty(),
  body("userName").isString().trim().notEmpty(),
  validate,
  async (req, res, next) => {
    try {
      const { emergencyId, userName } = req.body;
      const message =
        `✅ All clear: ${userName}'s SafeHer SOS (${emergencyId}) has been cancelled.\n` +
        `They are safe. No action required.`;

      const contacts = await Contact.find({ owner: req.user._id });
      const results = [];
      for (const contact of contacts) {
        if (contact.phone) {
          const result = await sendSms(contact.phone, message);
          results.push({ name: contact.name, ...result });
        }
      }

      res.json({ sent: results.length, results });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/ride-sms",
  requireRole("user"),
  body("service").isString().trim().isLength({ min: 1, max: 60 }),
  body("driverName").isString().trim().isLength({ min: 1, max: 100 }),
  body("driverPhone").optional().isString().trim().isLength({ max: 30 }),
  body("vehicle").isString().trim().isLength({ min: 1, max: 100 }),
  body("plate").isString().trim().isLength({ min: 1, max: 30 }),
  body("tripReference").optional().isString().trim().isLength({ max: 100 }),
  body("destination").optional().isString().trim().isLength({ max: 200 }),
  body("latitude").optional().isFloat({ min: -90, max: 90 }),
  body("longitude").optional().isFloat({ min: -180, max: 180 }),
  validate,
  async (req, res, next) => {
    try {
      const {
        service, driverName, driverPhone, vehicle, plate, tripReference,
        destination, latitude, longitude,
      } = req.body;
      const contacts = await Contact.find({ owner: req.user._id });
      const phoneContacts = contacts.filter((contact) => contact.phone);
      if (!phoneContacts.length) {
        return res.status(409).json({ error: "No trusted contacts with phone numbers are available." });
      }

      const locationLine = latitude != null && longitude != null
        ? `Current location: https://maps.google.com/?q=${latitude},${longitude}`
        : "Current location is unavailable.";
      const message = [
        `SafeHer ride check-in (${service})`,
        `Driver: ${driverName}`,
        driverPhone ? `Driver phone: ${driverPhone}` : "",
        `Vehicle: ${vehicle}`,
        `License plate: ${plate.toUpperCase()}`,
        tripReference ? `Trip reference: ${tripReference}` : "",
        destination ? `Destination: ${destination}` : "",
        locationLine,
        "I am sharing these details for my safety. Please check in with me if I do not confirm arrival.",
      ].filter(Boolean).join("\n");

      const smsConfigured = Boolean(process.env.FAST2SMS_API_KEY);
      const results = smsConfigured
        ? await Promise.all(phoneContacts.map(async (contact) => {
          const result = await sendSms(contact.phone, message);
          return { name: contact.name, phone: contact.phone, ok: result.ok };
        }))
        : phoneContacts.map((contact) => ({
          name: contact.name,
          phone: contact.phone,
          ok: false,
        }));
      const sentCount = results.filter((result) => result.ok).length;
      res.json({
        smsConfigured,
        sentCount,
        results,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/notify/fake-call
 * Body: { phone? } – if omitted, uses the authenticated user's phone
 * Triggers a fake incoming call via Edesy to distract a potential threat.
 */
router.post(
  "/fake-call",
  body("phone").optional().isString().trim(),
  validate,
  async (req, res, next) => {
    try {
      const phone = req.body.phone || req.user.phone;
      const result = await triggerFakeCall(phone);
      if (!result.ok) return res.status(503).json({ error: result.reason || "Voice service unavailable", data: result.data });

      res.json({
        ok: true,
        simulated: Boolean(result.simulated),
        message: result.simulated
          ? "Fake call scheduled! Your phone will ring with an incoming call in 3 seconds."
          : "Fake call initiated via telephony provider. Your phone should ring shortly.",
        data: result.data,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/notify/audio-alert
 * Automatically notifies police and trusted family contacts with the 10-second audio evidence link
 */
router.post(
  "/audio-alert",
  requireRole("user"),
  body("emergencyId").isString().trim().notEmpty(),
  body("userName").optional().isString().trim(),
  body("audioUrl").optional().isString().trim(),
  validate,
  async (req, res, next) => {
    try {
      const { emergencyId, userName = req.user.name, audioUrl } = req.body;
      const Emergency = require("../models/Emergency");
      const EmergencyAudio = require("../models/EmergencyAudio");
      const { client } = require("../db/supabase");

      const emergency = await Emergency.findOne({
        $or: [{ _id: emergencyId }, { emergencyId }],
      });

      // Generate signed URL if audioUrl not directly provided
      let finalAudioUrl = audioUrl;
      if (!finalAudioUrl && emergency) {
        const audioRecord = await EmergencyAudio.findOne({ emergencyId: emergency._id }).sort("-createdAt");
        if (audioRecord?.storageReference && client) {
          const { data } = await client.storage
            .from("emergency-audio")
            .createSignedUrl(audioRecord.storageReference, 86400); // 24h link
          finalAudioUrl = data?.signedUrl || null;
        }
      }

      // Fetch contacts
      const contacts = await Contact.find({ owner: req.user._id });
      const phoneContacts = contacts.filter((c) => c.phone);

      const audioLinkText = finalAudioUrl ? `\n🔊 Listen Audio Evidence: ${finalAudioUrl}` : "";
      const smsMessage =
        `🎙️ SafeHer Audio Evidence: 10s audio recorded during ${userName}'s SOS (${emergencyId}).${audioLinkText}\nCall 112 if immediate assistance is needed.`;

      const smsConfigured = Boolean(process.env.FAST2SMS_API_KEY);
      const results = await Promise.all(
        phoneContacts.map(async (c) => {
          const res = await sendSms(c.phone, smsMessage);
          return { name: c.name, phone: c.phone, ok: res.ok };
        })
      );

      // Realtime broadcast via Socket.IO to police & family
      const io = req.app.get("io");
      if (io) {
        const payload = {
          emergencyId: emergency?._id || emergencyId,
          userName,
          audioUrl: finalAudioUrl,
          recordedAt: new Date().toISOString(),
        };

        // Emit to emergency room
        io.to(`emergency:${emergency?._id || emergencyId}`).emit("audio:evidence", payload);

        // Emit to police station
        if (emergency?.stationId) {
          io.to(`station:${emergency.stationId}`).emit("audio:evidence", payload);
        }
        io.to("police").emit("audio:evidence", payload);

        // Emit to family user rooms
        const familyUserIds = contacts.map((c) => c.contactUserId).filter(Boolean);
        familyUserIds.forEach((uid) => {
          io.to(`user:${uid}`).emit("audio:evidence", payload);
        });
      }

      res.json({
        ok: true,
        audioUrl: finalAudioUrl,
        sentCount: results.filter((r) => r.ok).length,
        totalContacts: phoneContacts.length,
        smsConfigured,
        results,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/notify/trip-sms
 * Automated trip plan SMS (zero human intervention)
 */
router.post(
  "/trip-sms",
  requireRole("user"),
  body("contactPhone").isString().trim().notEmpty(),
  body("contactName").optional().isString().trim(),
  body("userName").optional().isString().trim(),
  body("arrivalTime").isString().trim().notEmpty(),
  body("latitude").optional().isFloat({ min: -90, max: 90 }),
  body("longitude").optional().isFloat({ min: -180, max: 180 }),
  validate,
  async (req, res, next) => {
    try {
      const { contactPhone, contactName, userName = req.user.name, arrivalTime, latitude, longitude } = req.body;
      const locText =
        latitude != null && longitude != null
          ? `📍 Starting location: https://maps.google.com/?q=${latitude},${longitude}`
          : "Starting location not shared.";

      const message =
        `SafeHer Trip Notice from ${userName}:\n` +
        `Heading out now, estimated arrival / check-in by ${arrivalTime}.\n` +
        `${locText}\nPlease call me if I do not check in by this deadline.`;

      const smsResult = await sendSms(contactPhone, message);
      res.json({
        ok: smsResult.ok,
        smsConfigured: Boolean(process.env.FAST2SMS_API_KEY),
        result: smsResult,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/notify/trip-arrival
 * Automated trip arrival SMS (zero human intervention)
 */
router.post(
  "/trip-arrival",
  requireRole("user"),
  body("contactPhone").isString().trim().notEmpty(),
  body("userName").optional().isString().trim(),
  validate,
  async (req, res, next) => {
    try {
      const { contactPhone, userName = req.user.name } = req.body;
      const message = `✅ SafeHer Check-in: ${userName} has arrived safely! The trip check-in timer is now stopped.`;
      const smsResult = await sendSms(contactPhone, message);
      res.json({
        ok: smsResult.ok,
        smsConfigured: Boolean(process.env.FAST2SMS_API_KEY),
        result: smsResult,
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
module.exports.sendSms = sendSms;
