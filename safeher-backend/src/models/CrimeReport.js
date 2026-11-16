const { createModel } = require("../db/supabase");

module.exports = createModel(
  "crime_reports",
  {
    status: "SUBMITTED",
    priority: "HIGH",
  },
  {
    beforeSave() {
      if (!this.reportId) {
        this.reportId = `CRM-${Date.now().toString(36).toUpperCase()}`;
      }
    },
  }
);
