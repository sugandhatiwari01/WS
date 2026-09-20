const mongoose = require("mongoose");
module.exports = mongoose.model("EmergencyEvent", new mongoose.Schema({
  emergencyId: { type: mongoose.Schema.Types.ObjectId, ref: "Emergency", index: true, required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, type: { type: String, required: true }, metadata: mongoose.Schema.Types.Mixed
}, { timestamps: true }));
