const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  contactUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, lowercase: true, trim: true },
  phone: { type: String, trim: true },
  relationship: { type: String, trim: true, maxlength: 50 }
}, { timestamps: true });
schema.index({ owner: 1, email: 1 }, { unique: true, sparse: true });
schema.index({ owner: 1, contactUserId: 1 }, { unique: true });
schema.index({ owner: 1, phone: 1 }, { unique: true, sparse: true });
module.exports = mongoose.model("Contact", schema);
