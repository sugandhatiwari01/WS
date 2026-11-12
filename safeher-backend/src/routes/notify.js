/**
 * /api/notify — outbound notification service
 *
 * POST /api/notify/sos-sms     Send SOS SMS to all phone contacts + in-app socket events
 * POST /api/notify/sos-cancel  Send "all clear" SMS to contacts
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
  if (!process.env.EDESY_API_KEY || !process.env.EDESY_AGENT_ID) {
    return { ok: false, reason: "VOICE_NOT_CONFIGURED" };
  }
  try {
    const response = await fetch("https://voice-agent.edesy.in/api/v1/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.EDESY_API_KEY}` },
      body: JSON.stringify({ phoneNumber: phone, agentId: process.env.EDESY_AGENT_ID }),
    });
    const data = await response.json();
    return { ok: response.ok, data };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
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
      if (!phone) return res.status(400).json({ error: "No phone number on file. Provide one in the request body." });

      const result = await triggerFakeCall(phone);
      if (!result.ok) return res.status(503).json({ error: result.reason || "Voice service unavailable", data: result.data });

      res.json({ ok: true, message: "Fake call initiated. Your phone should ring shortly.", data: result.data });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
module.exports.sendSms = sendSms;
