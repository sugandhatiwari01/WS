const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  stationId: { type: String, unique: true, required: true, index: true },
  name: { type: String, required: true, trim: true },
  address: String,
  location: { type: { type: String, enum: ["Point"], required: true }, coordinates: { type: [Number], required: true } },
  active: { type: Boolean, default: true, index: true }
}, { timestamps: true });
schema.index({ location: "2dsphere" });
module.exports = mongoose.model("PoliceStation", schema);
