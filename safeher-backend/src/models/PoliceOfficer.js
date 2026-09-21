const { createModel } = require("../db/supabase");
module.exports = createModel("police_officers", { active: true });
