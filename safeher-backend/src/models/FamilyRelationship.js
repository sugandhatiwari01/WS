const { createModel } = require("../db/supabase");
module.exports = createModel("family_relationships", { status: "ACTIVE" });
