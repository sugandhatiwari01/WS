const mongoose = require("mongoose");
module.exports = mongoose.model("DeviceToken", new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true, required: true },
  token: { type: String, unique: true, required: true }, platform: String
}, { timestamps: true }));
