const bcrypt = require("bcryptjs");
const { createModel } = require("../db/supabase");
module.exports = createModel("users", { role: "user", isActive: true }, {
  async setPassword(password) { this.passwordHash = await bcrypt.hash(password, 12); },
  verifyPassword(password) { return bcrypt.compare(password, this.passwordHash); },
  toJSON() { const value = { ...this }; delete value.passwordHash; return value; }
});
