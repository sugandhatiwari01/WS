const { createModel } = require("../db/supabase");

const PopulationData = createModel(
  "population_data",
  {
    dataSource: "Census of India",
    reportingYear: 2011,
  }
);

module.exports = PopulationData;
