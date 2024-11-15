const express = require("express");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const config = require("../config/config");
const logger = require("../utils/logger");
const notificationService = require("./notificationService");

class WebService {
  constructor() {
    this.app = null;
    this.server = null;
    this.io = null;
  }

  async initialize() {
    try {
      const dev = process.env.NODE_ENV !== "production";

      this.app = express();

      this.app.use(
        cors({
          origin: ["http://localhost:3000", "http://localhost:3001"],
          methods: ["GET", "POST", "OPTIONS"],
          credentials: true,
          allowedHeaders: ["Authorization", "Content-Type"],
        })
      );

      this.server = require("http").createServer(this.app);

      this.io = new Server(this.server, {
        cors: {
          origin: ["http://localhost:3000", "http://localhost:3001"],
          methods: ["GET", "POST", "OPTIONS"],
          credentials: true,
          allowedHeaders: ["Authorization", "Content-Type"],
        },
      });

      // Setup WebSocket authentication
      this.io.use((socket, next) => {
        try {
          const token = socket.handshake.auth.token;
          if (!token) {
            logger.error("No token provided");
            return next(new Error("Authentication error"));
          }

          const [header, payload, signature] = token.split(".");
          if (!header || !payload || !signature) {
            logger.error("Invalid token format");
            return next(new Error("Authentication error"));
          }

          try {
            const decodedPayload = JSON.parse(
              Buffer.from(payload, "base64").toString()
            );
            const secret = Buffer.from(signature, "base64").toString();

            if (secret !== config.jwt.secret) {
              logger.error("Invalid JWT secret");
              return next(new Error("Authentication error"));
            }

            // Verify user exists and is active
            const userId = decodedPayload.userId;

            socket.userId = userId;
            logger.info(`Authenticated user ${socket.userId}`);
            next();
          } catch (error) {
            logger.error("Token parsing error:", error);
            return next(new Error("Authentication error"));
          }
        } catch (err) {
          logger.error("Socket authentication error:", err);
          return next(new Error("Authentication error"));
        }
      });

      // Handle WebSocket connections
      this.io.on("connection", (socket) => {
        const userId = socket.userId;
        logger.info(`WebSocket client connected: ${userId}`);

        // Add to notification service
        notificationService.addWebClient(userId, socket);

        socket.on("disconnect", () => {
          logger.info(`WebSocket client disconnected: ${userId}`);
          notificationService.removeWebClient(userId);
        });
      });

      // Try different ports if 3001 is in use
      const tryPort = async (port) => {
        try {
          await new Promise((resolve, reject) => {
            this.server
              .listen(port, () => resolve())
              .on("error", (err) => {
                if (err.code === "EADDRINUSE") {
                  reject(new Error(`Port ${port} is in use`));
                } else {
                  reject(err);
                }
              });
          });
          logger.info(`Web interface running on port ${port}`);
          return true;
        } catch (error) {
          if (port < 3010) {
            // Try up to port 3010
            return tryPort(port + 1);
          }
          throw error;
        }
      };

      await tryPort(3001);
    } catch (error) {
      logger.error("Failed to initialize web service", {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  async close() {
    try {
      if (this.server) {
        await new Promise((resolve) => this.server.close(resolve));
      }
      logger.info("Web service closed");
    } catch (error) {
      logger.error("Error closing web service", error);
    }
  }
}

module.exports = new WebService();
