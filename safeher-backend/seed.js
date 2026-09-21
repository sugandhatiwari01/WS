require("dotenv").config();
const User = require("./src/models/User");
const PoliceStation = require("./src/models/PoliceStation");
const PoliceOfficer = require("./src/models/PoliceOfficer");

async function ensureUser(email, name, password, phone, role = "user") {
  let user = await User.findOne({ email });
  if (!user) {
    user = new User({ name, email, phone, role, passwordHash: "pending" });
    await user.setPassword(password);
    await user.save();
    console.log(`Created ${email}`);
  }
  return user;
}

async function seed() {
  const admin = await ensureUser(
    process.env.SEED_ADMIN_EMAIL || "admin@safeher.local",
    "SafeHer Admin",
    process.env.SEED_ADMIN_PASSWORD || "ChangeMe123!",
    undefined,
    "admin"
  );
  await ensureUser("user.one@safeher.local", "Demo User One", "ChangeMe123!", "+911111111111");
  await ensureUser("user.two@safeher.local", "Demo User Two", "ChangeMe123!", "+922222222222");
  const station = await PoliceStation.findOneAndUpdate(
    { stationId: "STN-1001" },
    { stationId: "STN-1001", name: "Central Police Station", address: "Demo address", location: { type: "Point", coordinates: [77.5946, 12.9716] }, active: true },
    { upsert: true, new: true }
  );
  const officer = await ensureUser("officer@safeher.local", "Demo Officer", "ChangeMe123!", undefined, "police");
  await PoliceOfficer.findOneAndUpdate(
    { userId: officer._id },
    { userId: officer._id, stationId: station.stationId, badgeNumber: "BADGE-1001", active: true },
    { upsert: true, new: true }
  );
  return admin;
}

seed().catch(error => {
  console.error("Unable to seed Supabase:", error);
  process.exitCode = 1;
});
