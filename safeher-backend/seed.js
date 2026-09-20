require("dotenv").config();
const mongoose = require("mongoose");
const User = require("./src/models/User");
const PoliceStation = require("./src/models/PoliceStation");
const PoliceOfficer = require("./src/models/PoliceOfficer");
async function seed() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  await mongoose.connect(process.env.MONGO_URI);
  const ensureUser = async (email, name, password, phone) => {
    let user = await User.findOne({ email });
    if (!user) {
      user = new User({ name, email, phone, role: "user", passwordHash: "pending" });
      await user.setPassword(password);
      await user.save();
      console.log(`Created ${email}`);
    }
    return user;
  };
  const existing = await User.findOne({ email: process.env.SEED_ADMIN_EMAIL || "admin@safeher.local" });
  if (!existing) { const user = new User({ name: "SafeHer Admin", email: process.env.SEED_ADMIN_EMAIL || "admin@safeher.local", role: "admin", passwordHash: "pending" }); await user.setPassword(process.env.SEED_ADMIN_PASSWORD || "ChangeMe123!"); await user.save(); console.log(`Created ${user.email}`); }
  await ensureUser("user.one@safeher.local", "Demo User One", "ChangeMe123!", "+911111111111");
  await ensureUser("user.two@safeher.local", "Demo User Two", "ChangeMe123!", "+922222222222");
  const station = await PoliceStation.findOneAndUpdate({ stationId: "STN-1001" }, { stationId: "STN-1001", name: "Central Police Station", address: "Demo address", location: { type: "Point", coordinates: [77.5946, 12.9716] }, active: true }, { upsert: true, new: true, setDefaultsOnInsert: true });
  const officer = await User.findOneAndUpdate({ email: "officer@safeher.local" }, { name: "Demo Officer", email: "officer@safeher.local", role: "police", passwordHash: "pending" }, { upsert: true, new: true, setDefaultsOnInsert: true });
  if (officer.passwordHash === "pending") { await officer.setPassword("ChangeMe123!"); await officer.save(); }
  await PoliceOfficer.findOneAndUpdate({ userId: officer._id }, { userId: officer._id, stationId: station.stationId, badgeNumber: "BADGE-1001", active: true }, { upsert: true, new: true, setDefaultsOnInsert: true });
  await mongoose.disconnect();
}
seed().catch(error => {
  if (error.code === "ETIMEOUT" || error.code === "ENOTFOUND" || error.syscall === "querySrv") {
    console.error("MongoDB Atlas DNS/network lookup failed. Check internet/VPN/DNS, confirm the cluster is running, and verify the Atlas connection string.");
  }
  console.error(error);
  process.exitCode = 1;
});
