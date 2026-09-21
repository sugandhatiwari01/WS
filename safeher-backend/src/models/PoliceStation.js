const { createModel } = require("../db/supabase");
module.exports = createModel("police_stations", { active: true });
