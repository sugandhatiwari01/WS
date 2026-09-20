const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { jwtSecret } = require("../config");
async function requireAuth(req, res, next) {
  try {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ error: "Authentication required" });
    const payload = jwt.verify(token, jwtSecret);
    req.user = await User.findById(payload.sub);
    if (!req.user || !req.user.isActive) return res.status(401).json({ error: "Invalid user" });
    next();
  } catch (_) { res.status(401).json({ error: "Invalid or expired token" }); }
}
const requireRole = (...roles) => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: "Insufficient permissions" });
module.exports = { requireAuth, requireRole };
