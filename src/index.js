const config = require("./config/config");
const logger = require("./utils/logger");
const setupWizard = require("./utils/setupWizard");
const setup = require("./utils/setup");
const fs = require("fs");

// Move service requires inside functions to prevent early initialization
let emailService, aiService, telegramService, taskService, dbService;

async function loadServices() {
  try {
    emailService = require("./services/emailService");
    aiService = require("./services/aiService");
    telegramService = require("./services/telegramService");
    taskService = require("./services/taskService");
    dbService = require("./services/dbService");

    // Initialize database service first
    await dbService.initialize();

    // Set up the connection between services
    dbService.setTaskService(taskService);

    logger.info("Services loaded successfully");
  } catch (error) {
    logger.error("Error loading services", { error: error.message });
    throw error;
  }
}

async function checkConfig() {
  if (!fs.existsSync(".env")) {
    logger.info("No configuration found. Starting setup wizard...");
    await setupWizard.run();
    // Reload config after setup
    delete require.cache[require.resolve("./config/config")];
    return require("./config/config");
  }
  return config;
}

async function waitForUserResponse() {
  return new Promise((resolve) => {
    const checkInterval = setInterval(() => {
      if (
        !telegramService.pendingConfirmations.has(
          parseInt(config.telegram.userId)
        )
      ) {
        clearInterval(checkInterval);
        resolve();
      }
    }, 1000); // Check every second
  });
}

async function processEmail(email) {
  try {
    // Skip if email has been processed
    if (emailService.processedEmails.has(email.id)) {
      logger.info(`Skipping already processed email ${email.id}`);
      return;
    }

    // Analyze email
    logger.info(`Analyzing email ${email.id}`);
    const analysis = await aiService.analyzeEmail(email);

    // Send confirmation request
    await telegramService.sendConfirmation(
      config.telegram.userId,
      email,
      analysis
    );

    // Wait for user response before proceeding
    logger.info(`Waiting for user response for email ${email.id}`);
    await waitForUserResponse();
    logger.info(`User responded to email ${email.id}`);
  } catch (error) {
    logger.error(`Error processing email ${email.id}`, {
      error: error.message,
      stack: error.stack,
    });
  }
}

let isProcessingEmails = false;

// Add this function for initial task extraction
async function extractTasksFromEmails() {
  try {
    // Initialize services first
    logger.info("Initializing services for task extraction...");

    try {
      await emailService.initialize();
      logger.info("Email service initialized");
    } catch (error) {
      logger.error("Failed to initialize email service", {
        error: error.message,
      });
      throw error;
    }

    try {
      await telegramService.initialize();
      logger.info("Telegram service initialized");
    } catch (error) {
      logger.error("Failed to initialize telegram service", {
        error: error.message,
      });
      throw error;
    }

    logger.info("Starting task extraction process...");
    const emails = await emailService.fetchUnreadEmails();
    logger.info(`Found ${emails.length} unread emails for task extraction`);

    const taskExtractionResults = [];
    const autoArchiveEmails = new Set();

    // Process emails in parallel batches
    const BATCH_SIZE = 10; // Process 10 emails at a time

    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
      const batch = emails.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.all(
        batch.map(async (email) => {
          if (!emailService.processedEmails.has(email.id)) {
            try {
              const quickAnalysis = await aiService.quickAnalyzeEmail(email);

              if (quickAnalysis.shouldAutoArchive) {
                autoArchiveEmails.add(email.id);
                logger.info(
                  `Email ${email.id} marked for auto-archiving: ${quickAnalysis.reason}`
                );
                return null;
              } else {
                logger.info(`Analyzing email ${email.id} for tasks`);
                const tasks = await taskService.extractTasksFromEmail(email);
                if (tasks && tasks.length > 0) {
                  return { email, tasks };
                }
              }
            } catch (taskError) {
              logger.error(`Error in task analysis for email ${email.id}`, {
                error: taskError.message,
              });
            }
          }
          return null;
        })
      );

      // Add successful results to taskExtractionResults
      taskExtractionResults.push(
        ...batchResults.filter((result) => result !== null)
      );
    }

    // Process extracted tasks if any
    if (taskExtractionResults.length > 0) {
      try {
        logger.info(
          `Optimizing ${taskExtractionResults.length} task groups...`
        );
        await taskService.optimizeTaskList(taskExtractionResults);
        await telegramService.notifyTaskSummary(taskExtractionResults);
      } catch (optimizeError) {
        logger.error("Error optimizing task list", {
          error: optimizeError.message,
        });
      }
    }

    // Auto-archive emails in parallel
    if (autoArchiveEmails.size > 0) {
      await Promise.all(
        Array.from(autoArchiveEmails).map((emailId) =>
          emailService
            .archiveEmail(emailId)
            .then(() => logger.info(`Auto-archived email ${emailId}`))
            .catch((error) =>
              logger.error(`Error auto-archiving email ${emailId}`, { error })
            )
        )
      );
    }

    return { taskExtractionResults, autoArchiveEmails };
  } catch (error) {
    logger.error("Error in task extraction process", {
      error: error.message,
      stack: error.stack,
    });
    return { taskExtractionResults: [], autoArchiveEmails: new Set() };
  }
}

// Update the processEmails function
async function processEmails(startProcessing = false) {
  try {
    logger.info("Processing emails");
    if (startProcessing) {
      // Fetch unread emails
      const emails = await emailService.fetchUnreadEmails();
      logger.info(`Found ${emails.length} unread emails`);

      // Filter out emails that have been auto-archived or already processed
      const unprocessedEmails = emails.filter(
        (email) => !emailService.processedEmails.has(email.id)
      );

      if (unprocessedEmails.length > 0) {
        // Process one email at a time
        for (const email of unprocessedEmails) {
          await processEmail(email);
          // Wait a bit between emails to avoid overwhelming the user
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } else {
        await telegramService.bot.sendMessage(
          config.telegram.userId,
          "📧 No emails to process at this time."
        );
      }
      logger.info("Finished processing emails");
    }
  } catch (error) {
    logger.error("Error in email processing cycle", {
      error: error.message,
      stack: error.stack,
    });

    if (error.message.includes("Failed to initialize")) {
      logger.error("Critical initialization error, exiting...");
      throw error;
    }
  }
}

// Update the startEmailProcessing function
module.exports = {
  startEmailProcessing: async () => {
    if (!isProcessingEmails) {
      isProcessingEmails = true;
      await processEmails(true);
      isProcessingEmails = false; // Reset flag when done
    }
  },
  stopEmailProcessing: () => {
    isProcessingEmails = false;
  },
  isProcessingEmails: () => isProcessingEmails,
  processEmails: () => processEmails(false), // For initial task extraction only
};

// Update the main function
async function main() {
  try {
    // Ensure required directories exist
    setup.ensureDirectoriesExist();

    // Check required files
    if (!setup.checkRequiredFiles()) {
      throw new Error("Missing required files");
    }

    // Check and setup configuration
    await checkConfig();

    // Load services after config is ready
    await loadServices();

    // Start with initial task extraction
    await extractTasksFromEmails();

    // Set up interval for future task extractions
    setInterval(async () => {
      if (!isProcessingEmails) {
        await extractTasksFromEmails();
      }
    }, 5 * 60 * 1000);
  } catch (error) {
    logger.error("Failed to start service", {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
}

// Add global error handlers
process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception:", {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection:", {
    reason: reason,
    stack: reason?.stack,
  });
  process.exit(1);
});

// Update the existing process handlers
process.on("SIGINT", async () => {
  const telegramService = require("./services/telegramService");
  const dbService = require("./services/dbService");
  await telegramService.cleanup();
  await dbService.cleanup();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  const telegramService = require("./services/telegramService");
  const dbService = require("./services/dbService");
  await telegramService.cleanup();
  await dbService.cleanup();
  process.exit(0);
});

main();
