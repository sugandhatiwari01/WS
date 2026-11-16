const { createModel } = require("../db/supabase");

const CitizenSafetyReport = createModel(
  "citizen_safety_reports",
  {
    verificationStatus: "PENDING",
  },
  {
    beforeSave() {
      if (!this.reportId) {
        this.reportId = `REP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      }
      if (this.latitude != null && this.longitude != null && !this.location) {
        this.location = {
          type: "Point",
          coordinates: [this.longitude, this.latitude],
        };
      }
    },
  }
);

module.exports = CitizenSafetyReport;
