const express = require("express");
const { body, param, query, validationResult } = require("express-validator");
const Contact = require("../models/Contact");
const User = require("../models/User");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
const valid = (req, res, next) => {
  const e = validationResult(req);
  return e.isEmpty() ? next() : res.status(400).json({ error: e.array()[0].msg });
};

router.use(requireAuth);

/** GET /api/contacts — all contacts for the current user (both app_user and phone_only) */
router.get("/", async (req, res, next) => {
  try {
    res.json(await Contact.find({ owner: req.user._id }).sort("name"));
  } catch (e) {
    next(e);
  }
});

/** GET /api/contacts/search?email=... — look up a registered SafeHer user to link */
router.get(
  "/search",
  query("email").isEmail().normalizeEmail(),
  valid,
  async (req, res, next) => {
    try {
      const user = await User.findOne({ email: req.query.email, role: "user", isActive: true }).select(
        "_id name email phone"
      );
      if (!user || String(user._id) === String(req.user._id)) {
        return res.status(404).json({ error: "REGISTERED_USER_NOT_FOUND" });
      }
      res.json(user);
    } catch (e) {
      next(e);
    }
  }
);

/**
 * POST /api/contacts
 * Add a contact who is a registered SafeHer user (linked by email).
 * They will receive real-time in-app alerts via Socket.IO.
 */
router.post(
  "/",
  body("email").isEmail().normalizeEmail(),
  body("relationship").optional().isLength({ max: 50 }),
  valid,
  async (req, res, next) => {
    try {
      const user = await User.findOne({ email: req.body.email, role: "user", isActive: true }).select(
        "_id name email phone"
      );
      if (!user) return res.status(404).json({ error: "REGISTERED_USER_NOT_FOUND" });
      if (String(user._id) === String(req.user._id)) {
        return res.status(400).json({ error: "CANNOT_ADD_YOURSELF" });
      }
      if (await Contact.exists({ owner: req.user._id, contactUserId: user._id })) {
        return res.status(409).json({ error: "CONTACT_ALREADY_EXISTS" });
      }
      const contact = await Contact.create({
        owner: req.user._id,
        contactUserId: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone || null,
        relationship: req.body.relationship || null,
        type: "app_user",
      });
      res.status(201).json(contact);
    } catch (e) {
      next(e);
    }
  }
);

/**
 * POST /api/contacts/phone
 * Add a phone-only contact (family/friend who doesn't have the SafeHer app).
 * They receive SMS alerts only.
 */
router.post(
  "/phone",
  body("name").trim().isLength({ min: 2, max: 100 }).withMessage("Name must be 2–100 characters"),
  body("phone")
    .isString()
    .trim()
    .matches(/^\+?[0-9]{7,15}$/)
    .withMessage("Enter a valid phone number (7-15 digits, optional + prefix)"),
  body("relationship").optional().isLength({ max: 50 }),
  valid,
  async (req, res, next) => {
    try {
      const { name, phone, relationship } = req.body;

      // Normalize phone number — strip non-digit chars except leading +
      const normalized = phone.startsWith("+") ? "+" + phone.slice(1).replace(/\D/g, "") : phone.replace(/\D/g, "");

      if (await Contact.exists({ owner: req.user._id, phone: normalized, type: "phone_only" })) {
        return res.status(409).json({ error: "CONTACT_ALREADY_EXISTS" });
      }

      const contact = await Contact.create({
        owner: req.user._id,
        name: name.trim(),
        phone: normalized,
        relationship: relationship?.trim() || null,
        type: "phone_only",
        contactUserId: null,
        email: null,
      });
      res.status(201).json(contact);
    } catch (e) {
      next(e);
    }
  }
);

/** GET /api/family/emergencies — emergencies from users who added the caller as a contact */
router.get("/emergencies", async (req, res, next) => {
  try {
    const Emergency = require("../models/Emergency");
    const contacts = await Contact.find({ contactUserId: req.user._id }).select("owner");
    res.json(
      await Emergency.find({ userId: { $in: contacts.map((c) => c.owner) } })
        .sort("-createdAt")
        .limit(100)
    );
  } catch (e) {
    next(e);
  }
});

/** DELETE /api/contacts/:id */
router.delete("/:id", param("id").isString().trim().notEmpty(), valid, async (req, res, next) => {
  try {
    const result = await Contact.deleteOne({ _id: req.params.id, owner: req.user._id });
    if (!result.deletedCount) return res.status(404).json({ error: "Contact not found" });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

module.exports = router;
