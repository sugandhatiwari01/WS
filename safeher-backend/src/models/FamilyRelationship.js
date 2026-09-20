const mongoose = require("mongoose");
module.exports = mongoose.model("FamilyRelationship", new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true, required: true },
  familyUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true, required: true },
  status: { type: String, enum: ["PENDING", "ACTIVE"], default: "ACTIVE" }
}, { timestamps: true }));
