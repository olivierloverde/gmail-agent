const EventEmitter = require("events");
const logger = require("../utils/logger");
const summaryService = require("./summaryService");

class NotificationService extends EventEmitter {
  constructor() {
    super();
    this.webClients = new Map();
  }

  addWebClient(userId, socket) {
    try {
      this.webClients.set(userId, socket);
      logger.info(`Web client connected: ${userId}`);
    } catch (error) {
      logger.error("Error adding web client", {
        error: error.message,
        userId,
      });
    }
  }

  removeWebClient(userId) {
    try {
      this.webClients.delete(userId);
      logger.info(`Web client disconnected: ${userId}`);
    } catch (error) {
      logger.error("Error removing web client", {
        error: error.message,
        userId,
      });
    }
  }

  async broadcastSummary(userId, summary) {
    try {
      logger.info(`Broadcasting summary for user ${userId}`);

      // Send to web client if connected
      const webSocket = this.webClients.get(userId);
      if (webSocket?.connected) {
        try {
          webSocket.emit("summary", summary);
          logger.info(`Summary sent to web client: ${userId}`);
        } catch (error) {
          logger.error("Error sending to web client", {
            error: error.message,
            userId,
          });
        }
      }

      this.emit("summary", { userId, summary });
    } catch (error) {
      logger.error("Error broadcasting summary", {
        error: error.message,
        userId,
      });
    }
  }
}

module.exports = new NotificationService();
