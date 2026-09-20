const dotenv = require("dotenv");
dotenv.config();
module.exports = {
  jwtSecret: process.env.JWT_SECRET || "development-only-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  mongoUri: process.env.MONGO_URI,
  isProduction: process.env.NODE_ENV === "production"
};
