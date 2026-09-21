const { createModel } = require("../db/supabase");
module.exports = createModel("emergencies", { level: "LEVEL_1", triggerType: "SOS_BUTTON", type: "sos", status: "CREATED" }, {
  beforeSave() {
    if (!this.emergencyId) this.emergencyId = `EMG-${Date.now().toString(36).toUpperCase()}`;
    if (!this.userId) this.userId = this.requester;
    if (!this.requester) this.requester = this.userId;
  }
});
