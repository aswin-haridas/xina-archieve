require("dotenv").config();

module.exports = {
  PORT: process.env.PORT || 3000,
  API_KEY: process.env.OPENROUTER_API_KEY,
  API_URL: "https://openrouter.ai/api/v1/chat/completions",
  MODEL: "stepfun/step-3.5-flash:free",
};
