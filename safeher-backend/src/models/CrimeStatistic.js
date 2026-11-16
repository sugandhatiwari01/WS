const { createModel } = require("../db/supabase");

const CrimeStatistic = createModel(
  "crime_statistics",
  {
    dataSource: "NCRB",
    reportingYear: 2022,
  },
  {
    beforeSave() {
      if (this.riskIndex == null && this.crimeRatePerLakh != null) {
        // Normalize 0-200 crime rate into 0.0 - 1.0 index
        this.riskIndex = Math.min(1.0, Math.max(0.1, Number((this.crimeRatePerLakh / 200).toFixed(3))));
      }
    },
  }
);

module.exports = CrimeStatistic;
