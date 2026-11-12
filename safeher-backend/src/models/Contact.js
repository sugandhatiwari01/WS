const { createModel } = require("../db/supabase");

/**
 * Contact types:
 *  "app_user"   – linked to a registered SafeHer account; receives in-app + Socket.IO alerts
 *  "phone_only" – only a name + phone number; receives SMS alerts
 */
module.exports = createModel("contacts", { type: "app_user" });
