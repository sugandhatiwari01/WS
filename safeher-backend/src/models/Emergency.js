const mongoose = require("mongoose");
const emergencySchema = new mongoose.Schema({
  emergencyId: { type: String, unique: true, index: true },
  requester: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  level: { type: String, enum: ["LEVEL_1", "LEVEL_2", "LEVEL_3"], default: "LEVEL_1" },
  triggerType: { type: String, enum: ["SOS_BUTTON", "SHAKE", "TIMER", "MANUAL_LEVEL_2", "AUTO_ESCALATION"], default: "SOS_BUTTON" },
  type: { type: String, default: "sos" }, description: { type: String, maxlength: 2000 },
  status: { type: String, enum: ["CREATED", "DISPATCHED", "VIEWED", "ASSIGNED", "RESPONDING", "ON_SCENE", "RESOLVED", "CANCELLED", "FALSE_ALARM"], default: "CREATED", index: true },
  stationId: { type: String, index: true }, assignedOfficerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  responder: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  initialLocation: { latitude: Number, longitude: Number, accuracy: Number },
  currentLocation: { latitude: Number, longitude: Number, accuracy: Number, timestamp: Date, speed: Number, heading: Number },
  location: { lat: Number, lng: Number, address: String },
  startedAt: { type: Date, default: Date.now }, resolvedAt: Date, cancelledAt: Date, claimedAt: Date
}, { timestamps: true });
emergencySchema.pre("validate", function() {
  if (!this.emergencyId) this.emergencyId = `EMG-${Date.now().toString(36).toUpperCase()}`;
  if (!this.userId) this.userId = this.requester;
  if (!this.requester) this.requester = this.userId;
});
emergencySchema.index({ status: 1, createdAt: 1 });
module.exports = mongoose.model("Emergency", emergencySchema);
