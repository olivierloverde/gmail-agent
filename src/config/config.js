require("dotenv").config();
const path = require("path");

const config = {
  gmail: {
    credentials: process.env.GMAIL_CREDENTIALS
      ? path.resolve(process.env.GMAIL_CREDENTIALS)
      : null,
    scopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.send",
    ],
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    userId: process.env.TELEGRAM_USER_ID,
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
  },
  summary: {
    maxEmailsInSummary: 500,
  },
  web: {
    enabled: process.env.ENABLE_WEB_INTERFACE === "true",
    port: process.env.WEB_PORT || 3001,
  },
  jwt: {
    secret: process.env.JWT_SECRET || "default_secret_change_this",
  },
};

// Validate required configuration
if (!config.gmail.credentials) {
  console.error("Gmail credentials path is not set in environment variables");
}

if (config.web.enabled && !config.jwt.secret) {
  console.error("JWT secret is required when web interface is enabled");
}

module.exports = config;
