const express = require("express");
const { body, param, query, validationResult } = require("express-validator");
const Contact = require("../models/Contact");
const User = require("../models/User");
const { requireAuth } = require("../middleware/auth");
const router = express.Router();
const valid = (req, res, next) => { const e = validationResult(req); return e.isEmpty() ? next() : res.status(400).json({ error: e.array()[0].msg }); };
router.use(requireAuth);
router.get("/", async (req, res, next) => { try { res.json(await Contact.find({ owner: req.user._id }).sort("name")); } catch (e) { next(e); } });
router.get("/search", query("email").isEmail().normalizeEmail(), valid, async (req, res, next) => {
  try {
    const user = await User.findOne({ email: req.query.email, role: "user", isActive: true }).select("_id name email phone");
    if (!user || String(user._id) === String(req.user._id)) return res.status(404).json({ error: "REGISTERED_USER_NOT_FOUND" });
    res.json(user);
  } catch (e) { next(e); }
});
router.post("/", body("email").isEmail().normalizeEmail(), body("relationship").optional().isLength({ max: 50 }), valid, async (req, res, next) => {
  try {
    const user = await User.findOne({ email: req.body.email, role: "user", isActive: true }).select("_id name email phone");
    if (!user) return res.status(404).json({ error: "REGISTERED_USER_NOT_FOUND" });
    if (String(user._id) === String(req.user._id)) return res.status(400).json({ error: "CANNOT_ADD_YOURSELF" });
    if (await Contact.exists({ owner: req.user._id, contactUserId: user._id })) return res.status(409).json({ error: "CONTACT_ALREADY_EXISTS" });
    const contact = await Contact.create({ owner: req.user._id, contactUserId: user._id, name: user.name, email: user.email, phone: user.phone, relationship: req.body.relationship });
    res.status(201).json(contact);
  } catch (e) { next(e); }
});
router.get("/emergencies", async (req, res, next) => {
  try {
    const Emergency = require("../models/Emergency");
    const contacts = await Contact.find({ contactUserId: req.user._id }).select("owner");
    res.json(await Emergency.find({ userId: { $in: contacts.map(contact => contact.owner) } }).sort("-createdAt").limit(100));
  } catch (e) { next(e); }
});
router.delete("/:id", param("id").isMongoId(), valid, async (req, res, next) => { try { const result = await Contact.deleteOne({ _id: req.params.id, owner: req.user._id }); if (!result.deletedCount) return res.status(404).json({ error: "Contact not found" }); res.status(204).end(); } catch (e) { next(e); } });
module.exports = router;
