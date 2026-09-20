const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", unique: true, required: true },
  stationId: { type: String, required: true, index: true },
  badgeNumber: { type: String, unique: true, required: true },
  active: { type: Boolean, default: true }
}, { timestamps: true });
module.exports = mongoose.model("PoliceOfficer", schema);
