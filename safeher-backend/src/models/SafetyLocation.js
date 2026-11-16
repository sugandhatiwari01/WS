const { createModel } = require("../db/supabase");

const SafetyLocation = createModel(
  "safety_locations",
  {
    verificationStatus: "VERIFIED",
    dataSource: "OpenStreetMap",
  },
  {
    beforeSave() {
      if (!this.locationId) {
        this.locationId = `LOC-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
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

module.exports = SafetyLocation;
