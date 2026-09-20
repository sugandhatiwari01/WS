const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  phone: { type: String, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ["user", "family", "police", "responder", "admin"], default: "user" },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });
schema.methods.setPassword = async function (password) { this.passwordHash = await bcrypt.hash(password, 12); };
schema.methods.verifyPassword = function (password) { return bcrypt.compare(password, this.passwordHash); };
schema.methods.toJSON = function () { const value = this.toObject(); delete value.passwordHash; delete value.__v; return value; };
module.exports = mongoose.model("User", schema);
