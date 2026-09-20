const Emergency = require("../models/Emergency");
const transitions = {
  pending: ["claimed", "cancelled"], claimed: ["responding", "cancelled"],
  responding: ["resolved", "cancelled"], resolved: [], cancelled: []
};
async function claim(id, responderId) {
  return Emergency.findOneAndUpdate(
    { _id: id, status: "pending", responder: null },
    { $set: { status: "claimed", responder: responderId, claimedAt: new Date() } },
    { new: true, runValidators: true }
  ).populate("requester responder", "name phone email role");
}
async function transition(id, actor, status) {
  const emergency = await Emergency.findById(id);
  if (!emergency) { const error = new Error("Emergency not found"); error.status = 404; throw error; }
  const allowed = actor.role === "admin" || String(emergency.requester) === String(actor._id) ||
    String(emergency.responder) === String(actor._id);
  if (!allowed) { const error = new Error("Not allowed"); error.status = 403; throw error; }
  if (!transitions[emergency.status].includes(status)) { const error = new Error(`Cannot move from ${emergency.status} to ${status}`); error.status = 409; throw error; }
  emergency.status = status;
  if (status === "resolved") emergency.resolvedAt = new Date();
  if (status === "cancelled") emergency.cancelledAt = new Date();
  return emergency.save();
}
module.exports = { claim, transition };
