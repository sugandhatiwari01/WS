const mongoose = require("mongoose");
module.exports = mongoose.model("EmergencyAudio", new mongoose.Schema({
  emergencyId: { type: mongoose.Schema.Types.ObjectId, ref: "Emergency", index: true, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  timestamp: { type: Date, default: Date.now }, duration: Number, storageReference: { type: String, required: true }, available: { type: Boolean, default: true }
}, { timestamps: true }));
