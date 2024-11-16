const fs = require("fs");
const path = require("path");

class Logger {
  constructor() {
    this.logDir = path.join(__dirname, "../../logs");
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir);
    }
  }

  log(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      ...data,
    };

    console.log(`[${timestamp}] ${level}: ${message}`);

    // Write to file
    const logFile = path.join(
      this.logDir,
      `${new Date().toISOString().split("T")[0]}.log`
    );
    fs.appendFileSync(logFile, JSON.stringify(logEntry) + "\n");
  }

  info(message, data) {
    this.log("INFO", message, data);
  }

  error(message, data) {
    if (data) {
      console.error(data);
    }
    this.log("ERROR", message, data);
  }

  warn(message, data) {
    this.log("WARN", message, data);
  }
}

module.exports = new Logger();
