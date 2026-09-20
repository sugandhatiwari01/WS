require("dotenv").config();
const http = require("http");
const mongoose = require("mongoose");
const app = require("./src/app");
const { createSocketServer } = require("./src/socket");
const PoliceStation = require("./src/models/PoliceStation");

const port = Number(process.env.PORT || 3000);
const server = http.createServer(app);
const io = createSocketServer(server);
app.set("io", io);

async function start() {
  if (process.env.MONGO_URI) {
    try {
      await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
      await PoliceStation.createIndexes();
    } catch (error) {
      const canStartWithoutDatabase = process.env.NODE_ENV !== "production" && process.env.ALLOW_START_WITHOUT_DB === "true";
      if (!canStartWithoutDatabase) {
        console.error("MongoDB connection failed.");
        console.error("For MongoDB Atlas, add this machine's public IP under Security > Database & Network Access > IP Access List.");
        console.error("Then verify the username/password and URL-encoded special characters in MONGO_URI.");
        throw error;
      }
      console.warn("MongoDB is unavailable; starting in UI-only mode because ALLOW_START_WITHOUT_DB=true.");
    }
  } else if (process.env.NODE_ENV === "production") {
    throw new Error("MONGO_URI is required in production.");
  } else {
    console.warn("MONGO_URI is not configured; starting without database access.");
  }
  server.listen(port, () => console.log(`SafeHer backend listening on ${port}`));
}
if (require.main === module) {
  start().catch((error) => { console.error("Unable to start server:", error); process.exit(1); });
}
module.exports = { app, server, start };
