/**
 * Seed & Data Ingestion Pipeline for India Safety System
 * 
 * Ingests:
 * 1. Benchmark Safety Locations (Police, Hospitals, Streetlights, Transit)
 * 2. NCRB District-Level Crime Risk Indices
 * 3. Census Demographic & Urban Density Records
 */

require("dotenv").config();
const SafetyLocation = require("../src/models/SafetyLocation");
const CrimeStatistic = require("../src/models/CrimeStatistic");
const PopulationData = require("../src/models/PopulationData");
const data = require("../src/data/indiaSafetyData");

async function runSeed() {
  console.log("=== Starting India Safety Data Ingestion Pipeline ===");

  try {
    // 1. Safety Locations
    console.log(`Ingesting ${data.verifiedSafetyLocations.length} safety infrastructure locations...`);
    let locCount = 0;
    for (const loc of data.verifiedSafetyLocations) {
      const existing = await SafetyLocation.findOne({
        name: loc.name,
        latitude: loc.latitude,
        longitude: loc.longitude,
      });
      if (!existing) {
        await SafetyLocation.create(loc);
        locCount++;
      }
    }
    console.log(`✓ Safety locations added: ${locCount}`);

    // 2. Crime Statistics
    console.log(`Ingesting ${data.crimeStatistics.length} NCRB crime statistical records...`);
    let crimeCount = 0;
    for (const c of data.crimeStatistics) {
      const existing = await CrimeStatistic.findOne({
        state: c.state,
        district: c.district,
        crimeCategory: c.crimeCategory,
      });
      if (!existing) {
        await CrimeStatistic.create(c);
        crimeCount++;
      }
    }
    console.log(`✓ Crime statistics added: ${crimeCount}`);

    // 3. Population Data
    console.log(`Ingesting ${data.populationData.length} Census demographic records...`);
    let popCount = 0;
    for (const p of data.populationData) {
      const existing = await PopulationData.findOne({
        state: p.state,
        district: p.district,
      });
      if (!existing) {
        await PopulationData.create(p);
        popCount++;
      }
    }
    console.log(`✓ Population demographic records added: ${popCount}`);

    console.log("=== Data Ingestion Pipeline Completed Successfully ===");
  } catch (err) {
    console.error("Data ingestion failed:", err);
  }
}

if (require.main === module) {
  runSeed().then(() => process.exit(0)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = runSeed;
