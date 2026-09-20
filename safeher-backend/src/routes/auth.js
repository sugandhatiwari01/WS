const express = require("express");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const User = require("../models/User");
const { jwtSecret, jwtExpiresIn } = require("../config");
const router = express.Router();
const validate = (req, res, next) => { const errors = validationResult(req); return errors.isEmpty() ? next() : res.status(400).json({ error: errors.array()[0].msg }); };
const token = user => jwt.sign({ sub: user._id.toString(), role: user.role }, jwtSecret, { expiresIn: jwtExpiresIn });
router.post("/register", body("name").trim().isLength({ min: 2, max: 100 }), body("email").isEmail().normalizeEmail(), body("password").isLength({ min: 8 }), body("phone").optional().isString(), validate, async (req, res, next) => {
  try { const user = new User({ name: req.body.name, email: req.body.email, phone: req.body.phone, passwordHash: "pending" }); await user.setPassword(req.body.password); await user.save(); res.status(201).json({ user, token: token(user) }); } catch (e) { next(e); }
});
router.post("/login", body("email").isEmail().normalizeEmail(), body("password").notEmpty(), validate, async (req, res, next) => {
  try { const user = await User.findOne({ email: req.body.email }).select("+passwordHash"); if (!user || !(await user.verifyPassword(req.body.password))) return res.status(401).json({ error: "Invalid email or password" }); res.json({ user, token: token(user) }); } catch (e) { next(e); }
});
router.post("/refresh", body("token").notEmpty(), validate, (req, res) => {
  try { const payload = jwt.verify(req.body.token, jwtSecret); res.json({ token: jwt.sign({ sub: payload.sub, role: payload.role }, jwtSecret, { expiresIn: jwtExpiresIn }) }); }
  catch (_) { res.status(401).json({ error: "Invalid or expired token" }); }
});
module.exports = router;
