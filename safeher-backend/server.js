require("dotenv").config();
const http = require("http");
const app = require("./src/app");
const { createSocketServer } = require("./src/socket");
const { client, isConfigured } = require("./src/db/supabase");

const port = Number(process.env.PORT || 3000);
const server = http.createServer(app);
const io = createSocketServer(server);
app.set("io", io);

async function start() {
  if (isConfigured) {
    try {
      const { error } = await client.from("app_documents").select("id").limit(1);
      if (error) throw error;
    } catch (error) {
      const canStartWithoutDatabase = process.env.NODE_ENV !== "production" && process.env.ALLOW_START_WITHOUT_DB === "true";
      if (!canStartWithoutDatabase) {
        console.error("Supabase connection failed. Check SUPABASE_URL, the service-role key, and that supabase/schema.sql has been applied.");
        throw error;
      }
      console.warn("Supabase is unavailable; starting in UI-only mode because ALLOW_START_WITHOUT_DB=true.");
    }
  } else if (process.env.NODE_ENV === "production") {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in production.");
  } else {
    console.warn("Supabase is not configured; starting without database access.");
  }
  server.listen(port, () => console.log(`SafeHer backend listening on ${port}`));
}
if (require.main === module) {
  start().catch((error) => { console.error("Unable to start server:", error); process.exit(1); });
}
module.exports = { app, server, start };
