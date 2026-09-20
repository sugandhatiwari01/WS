const mongoose = require("mongoose");
module.exports = mongoose.model("EmergencyLocation", new mongoose.Schema({
  emergencyId: { type: mongoose.Schema.Types.ObjectId, ref: "Emergency", index: true, required: true },
  latitude: Number, longitude: Number, accuracy: Number, speed: Number, heading: Number, timestamp: { type: Date, default: Date.now }
}, { timestamps: true }));
