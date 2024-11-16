const TelegramBot = require("node-telegram-bot-api");
const config = require("../config/config");
const logger = require("../utils/logger");
const emailService = require("./emailService");
const aiService = require("./aiService");
const summaryService = require("./summaryService");
const cron = require("node-cron");
const taskService = require("./taskService");

class TelegramService {
  constructor() {
    this.bot = null;
    this.pendingConfirmations = new Map();
    this.editingResponses = new Map();
    this.isInitialized = false;
  }

  async initialize() {
    try {
      if (this.isInitialized) {
        logger.info("Telegram bot already initialized");
        return;
      }

      if (this.bot) {
        // Stop existing bot if any
        await this.stopBot();
      }

      this.bot = new TelegramBot(config.telegram.botToken, { polling: true });

      // Register command handlers
      this.bot.onText(/\/summary/, this.handleSummaryCommand.bind(this));
      this.bot.onText(/\/help/, this.handleHelpCommand.bind(this));
      this.bot.onText(/\/tasks/, this.handleTasksCommand.bind(this));
      this.bot.onText(
        /\/task_done (.+)/,
        this.handleTaskDoneCommand.bind(this)
      );
      this.bot.onText(
        /\/start_processing/,
        this.handleStartProcessing.bind(this)
      );
      this.bot.onText(
        /\/stop_processing/,
        this.handleStopProcessing.bind(this)
      );
      this.bot.onText(
        /\/processing_status/,
        this.handleProcessingStatus.bind(this)
      );

      // Register callback query handler
      this.bot.on("callback_query", this.handleCallbackQuery.bind(this));

      // Register general message handler
      this.bot.on("message", this.handleIncomingMessage.bind(this));

      // Handle polling errors
      this.bot.on("polling_error", (error) => {
        logger.error("Telegram polling error", { error: error.message });
        if (error.message.includes("terminated by other getUpdates request")) {
          this.handlePollingConflict();
        }
      });

      // Schedule summaries at 9 AM, 2 PM, and 7 PM
      this.scheduleSummaries();

      this.isInitialized = true;
      logger.info("Telegram bot initialized with scheduled summaries");
    } catch (error) {
      logger.error("Failed to initialize Telegram bot", {
        error: error.message,
      });
      throw error;
    }
  }

  async stopBot() {
    try {
      if (this.bot) {
        logger.info("Stopping Telegram bot...");
        await this.bot.stopPolling();
        this.bot = null;
        this.isInitialized = false;
        logger.info("Telegram bot stopped");
      }
    } catch (error) {
      logger.error("Error stopping Telegram bot", { error: error.message });
    }
  }

  async handlePollingConflict() {
    try {
      logger.info("Handling polling conflict...");
      await this.stopBot();
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second
      await this.initialize();
    } catch (error) {
      logger.error("Error handling polling conflict", { error: error.message });
    }
  }

  scheduleSummaries() {
    if (this.scheduledSummaries) {
      this.scheduledSummaries.forEach((schedule) => schedule.stop());
    }

    this.scheduledSummaries = [
      cron.schedule("0 9,14,19 * * *", () => {
        this.sendScheduledSummary();
      }),
    ];
  }

  // Add to class cleanup method
  async cleanup() {
    await this.stopBot();
    if (this.scheduledSummaries) {
      this.scheduledSummaries.forEach((schedule) => schedule.stop());
    }
  }

  // Update the existing handleStartProcessing method
  async handleStartProcessing(msg) {
    try {
      if (msg.from.id.toString() !== config.telegram.userId) {
        logger.warn(
          `Unauthorized start processing request from user ${msg.from.id}`
        );
        return;
      }

      const emailProcessor = require("../index");
      if (!emailProcessor.isProcessingEmails()) {
        // Reinitialize bot if needed
        if (!this.isInitialized) {
          await this.initialize();
        }

        await this.bot.sendMessage(
          msg.chat.id,
          "📧 Starting email processing..."
        );
        await emailProcessor.startEmailProcessing();
      } else {
        await this.bot.sendMessage(
          msg.chat.id,
          "📧 Email processing is already running"
        );
      }
    } catch (error) {
      logger.error("Error handling start processing command", {
        error: error.message,
      });
      await this.sendErrorMessage(msg.chat.id);
    }
  }

  // Update the existing handleStopProcessing method
  async handleStopProcessing(msg) {
    try {
      if (msg.from.id.toString() !== config.telegram.userId) {
        logger.warn(
          `Unauthorized stop processing request from user ${msg.from.id}`
        );
        return;
      }

      const emailProcessor = require("../index");
      if (emailProcessor.isProcessingEmails()) {
        emailProcessor.stopEmailProcessing();
        await this.bot.sendMessage(msg.chat.id, "📧 Email processing stopped");
      } else {
        await this.bot.sendMessage(
          msg.chat.id,
          "📧 Email processing is not running"
        );
      }
    } catch (error) {
      logger.error("Error handling stop processing command", {
        error: error.message,
      });
      await this.sendErrorMessage(msg.chat.id);
    }
  }

  async handleSummaryCommand(msg) {
    try {
      // Verify user authorization
      if (msg.from.id.toString() !== config.telegram.userId) {
        logger.warn(`Unauthorized summary request from user ${msg.from.id}`);
        return;
      }

      await this.bot.sendMessage(msg.chat.id, "📊 Choose summary type:", {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🌅 Morning Overview", callback_data: "summary_morning" },
              {
                text: "🌞 Midday Catch-up",
                callback_data: "summary_afternoon",
              },
            ],
            [
              { text: "🌙 Evening Wrap-up", callback_data: "summary_evening" },
              { text: "📋 Quick Summary", callback_data: "summary_regular" },
            ],
          ],
        },
      });
    } catch (error) {
      logger.error("Error handling summary command", { error: error.message });
      await this.sendErrorMessage(msg.chat.id);
    }
  }

  async handleHelpCommand(msg) {
    try {
      // Escape special characters for MarkdownV2 format
      const helpMessage = `
📧 *Gmail Agent Help*

*Email Commands:*
/start\\_processing \\- Start processing emails
/stop\\_processing \\- Stop email processing
/processing\\_status \\- Check processing status
/summary \\- Request an email summary

*Task Commands:*
/tasks \\- View and manage tasks
/task\\_done <task\\_id> \\- Mark a task as complete

*Summary Types:*
• Morning Overview \\(9 AM\\)
• Midday Catch\\-up \\(2 PM\\)
• Evening Wrap\\-up \\(7 PM\\)

*Task Management:*
• Tasks are automatically extracted from emails
• Tasks are prioritized as High/Medium/Low
• Tasks can have deadlines and dependencies
• Similar tasks are grouped automatically
• Task completion notifications are sent to original emails

*Email Processing:*
1\\. System first analyzes all emails for tasks
2\\. Auto\\-archives system notifications
3\\. Waits for your command to start processing
4\\. Processes remaining emails with your input

*Note:* Use /help anytime to see this message\\.`;

      await this.bot.sendMessage(msg.chat.id, helpMessage, {
        parse_mode: "MarkdownV2",
        disable_web_page_preview: true,
      });
    } catch (error) {
      logger.error("Error sending help message", {
        error: error.message,
        userId: msg.from.id,
      });
      // Send a plain text fallback message if markdown fails
      try {
        const fallbackMessage = `
📧 Gmail Agent Help

Email Commands:
/start_processing - Start processing emails
/stop_processing - Stop email processing
/processing_status - Check processing status
/summary - Request an email summary

Task Commands:
/tasks - View and manage tasks
/task_done <task_id> - Mark a task as complete

Summary Types:
• Morning Overview (9 AM)
• Midday Catch-up (2 PM)
• Evening Wrap-up (7 PM)

Task Management:
• Tasks are automatically extracted from emails
• Tasks are prioritized as High/Medium/Low
• Tasks can have deadlines and dependencies
• Similar tasks are grouped automatically
• Task completion notifications are sent to original emails

Email Processing:
1. System first analyzes all emails for tasks
2. Auto-archives system notifications
3. Waits for your command to start processing
4. Processes remaining emails with your input

Note: Use /help anytime to see this message.`;

        await this.bot.sendMessage(msg.chat.id, fallbackMessage);
      } catch (fallbackError) {
        logger.error("Error sending fallback help message", {
          error: fallbackError.message,
          userId: msg.from.id,
        });
        await this.sendErrorMessage(msg.chat.id);
      }
    }
  }

  // Add callback query handler for summary buttons
  async handleCallbackQuery(callbackQuery) {
    try {
      const userId = callbackQuery.from.id.toString();
      if (userId !== config.telegram.userId) {
        logger.warn(`Unauthorized callback query from user ${userId}`);
        return;
      }

      const action = callbackQuery.data;

      // Handle task-related callbacks
      if (action.startsWith("tasks_")) {
        await this.handleTasksCallback(callbackQuery);
        return;
      }

      if (action.startsWith("summary_")) {
        const summaryType = action.split("_")[1];
        await this.bot.sendMessage(
          callbackQuery.message.chat.id,
          `Generating ${summaryType} summary...`
        );

        // Override the summary type temporarily
        const originalGetSummaryType = summaryService.getSummaryType;
        summaryService.getSummaryType = () => summaryType;

        // Generate and send the summary
        const summary = await summaryService.generateHourlySummary();

        // Restore the original method
        summaryService.getSummaryType = originalGetSummaryType;

        if (summary.startsWith("Error generating summary:")) {
          logger.error("Summary generation failed", { summary });
          await this.bot.sendMessage(
            callbackQuery.message.chat.id,
            "An error occurred while generating the summary. Please try again later or contact support."
          );
        } else {
          await this.bot.sendMessage(callbackQuery.message.chat.id, summary);
        }
      }

      // Answer the callback query to remove the loading state
      await this.bot.answerCallbackQuery(callbackQuery.id);
    } catch (error) {
      logger.error("Error handling callback query", {
        error: error.message,
        stack: error.stack,
      });
      await this.sendErrorMessage(callbackQuery.message.chat.id);
    }
  }

  async handleTasksCallback(callbackQuery) {
    try {
      const action = callbackQuery.data;
      const chatId = callbackQuery.message.chat.id;
      let tasks = [];
      let title = "";

      switch (action) {
        case "tasks_all":
          tasks = await taskService.getTasks();
          title = "All Tasks";
          break;
        case "tasks_due":
          tasks = taskService.getDueTasks(7);
          title = "Due Tasks (Next 7 Days)";
          break;
        case "tasks_high":
          tasks = (await taskService.getTasks({ priority: "HIGH" })).filter(
            (task) => task.status !== "COMPLETED"
          );
          title = "High Priority Tasks";
          break;
        case "tasks_medium":
          tasks = (await taskService.getTasks({ priority: "MEDIUM" })).filter(
            (task) => task.status !== "COMPLETED"
          );
          title = "Medium Priority Tasks";
          break;
        case "tasks_menu":
          // Return to main tasks menu
          await this.handleTasksCommand(callbackQuery.message);
          await this.bot.answerCallbackQuery(callbackQuery.id);
          return;
        case "tasks_refresh":
          // Re-fetch the current category
          const currentTitle = callbackQuery.message.text.split("\n")[0];
          await this.handleTasksCallback({
            ...callbackQuery,
            data: this.getActionFromTitle(currentTitle),
          });
          return;
      }

      if (!tasks || tasks.length === 0) {
        await this.bot.sendMessage(
          chatId,
          `*${this.escapeSpecialChars(
            title
          )}*\n\n_No tasks found in this category\\._\n\nUse the buttons below to view other categories:`,
          {
            parse_mode: "MarkdownV2",
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "📊 All Tasks", callback_data: "tasks_all" },
                  { text: "⏰ Due Tasks", callback_data: "tasks_due" },
                ],
                [
                  { text: "🔴 High Priority", callback_data: "tasks_high" },
                  { text: "🟡 Medium Priority", callback_data: "tasks_medium" },
                ],
                [{ text: "◀️ Back to Menu", callback_data: "tasks_menu" }],
              ],
            },
          }
        );
      } else {
        await this.sendTaskList(chatId, tasks, title);
      }

      // Answer the callback query to remove loading state
      await this.bot.answerCallbackQuery(callbackQuery.id);
    } catch (error) {
      logger.error("Error handling tasks callback", {
        error: error.message,
        action: callbackQuery.data,
      });
      await this.sendErrorMessage(callbackQuery.message.chat.id);
      await this.bot.answerCallbackQuery(callbackQuery.id);
    }
  }

  // Helper method to determine action from title
  getActionFromTitle(title) {
    const titleMap = {
      "All Tasks": "tasks_all",
      "Due Tasks": "tasks_due",
      "High Priority Tasks": "tasks_high",
      "Medium Priority Tasks": "tasks_medium",
    };

    for (const [key, value] of Object.entries(titleMap)) {
      if (title.includes(key)) return value;
    }
    return "tasks_all"; // Default fallback
  }

  async sendTaskList(chatId, tasks, title) {
    try {
      const MAX_MESSAGE_LENGTH = 4000; // Leave some margin for Telegram's 4096 limit

      if (tasks.length === 0) {
        await this.bot.sendMessage(
          chatId,
          `*${this.escapeSpecialChars(title)}*\n\n_No tasks found\\._`,
          {
            parse_mode: "MarkdownV2",
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "📊 All Tasks", callback_data: "tasks_all" },
                  { text: "⏰ Due Tasks", callback_data: "tasks_due" },
                ],
                [
                  { text: "🔴 High Priority", callback_data: "tasks_high" },
                  { text: "🟡 Medium Priority", callback_data: "tasks_medium" },
                ],
                [{ text: "◀️ Back to Menu", callback_data: "tasks_menu" }],
              ],
            },
          }
        );
        return;
      }

      // Send title first
      let currentMessage = `*${this.escapeSpecialChars(title)}*\n\n`;
      let taskCounter = 1;
      let messageCounter = 1;

      for (const task of tasks) {
        // Format task entry
        const safeDescription = this.escapeSpecialChars(task.description);
        const safeId = this.escapeSpecialChars(task.id);
        const priority = this.getPriorityEmoji(task.priority);
        const deadline = task.deadline
          ? ` \\(Due: ${this.escapeSpecialChars(task.deadline)}\\)`
          : "";

        const taskEntry = `${taskCounter}\\. ${priority} ID: \`${safeId}\`\n    ${safeDescription}${deadline}\n\n`;

        // Check if adding this task would exceed the limit
        if ((currentMessage + taskEntry).length > MAX_MESSAGE_LENGTH) {
          // Send current message
          await this.bot.sendMessage(chatId, currentMessage, {
            parse_mode: "MarkdownV2",
          });

          // Start new message with title indicating continuation
          currentMessage = `*${this.escapeSpecialChars(
            title
          )} \\(continued ${++messageCounter}\\)*\n\n`;
        }

        currentMessage += taskEntry;
        taskCounter++;
      }

      // Add instructions to the last message
      const instructions =
        "\n_Use_ /task\\_done _followed by the task ID to mark it complete_";

      // Check if adding instructions would exceed limit
      if ((currentMessage + instructions).length > MAX_MESSAGE_LENGTH) {
        // Send current message
        await this.bot.sendMessage(chatId, currentMessage, {
          parse_mode: "MarkdownV2",
        });
        currentMessage = instructions;
      } else {
        currentMessage += instructions;
      }

      // Send final message with enhanced navigation buttons
      await this.bot.sendMessage(chatId, currentMessage, {
        parse_mode: "MarkdownV2",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🔄 Refresh List", callback_data: "tasks_refresh" },
              { text: "⏰ Due Tasks", callback_data: "tasks_due" },
            ],
            [
              { text: "🔴 High Priority", callback_data: "tasks_high" },
              { text: "🟡 Medium Priority", callback_data: "tasks_medium" },
            ],
            [{ text: "◀️ Back to Menu", callback_data: "tasks_menu" }],
          ],
        },
      });
    } catch (error) {
      logger.error("Error sending task list", {
        error: error.message,
        chatId,
        taskCount: tasks?.length,
      });

      // Send a simplified fallback message
      try {
        await this.bot.sendMessage(
          chatId,
          `${title}\n\n${tasks.length} tasks found. The list is too long to display fully.\n\nUse the menu below to view different categories:`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "📊 All Tasks", callback_data: "tasks_all" },
                  { text: "⏰ Due Tasks", callback_data: "tasks_due" },
                ],
                [
                  { text: "🔴 High Priority", callback_data: "tasks_high" },
                  { text: "🟡 Medium Priority", callback_data: "tasks_medium" },
                ],
                [{ text: "◀️ Back to Menu", callback_data: "tasks_menu" }],
              ],
            },
          }
        );
      } catch (fallbackError) {
        logger.error("Error sending fallback task list", {
          error: fallbackError.message,
        });
        await this.sendErrorMessage(chatId);
      }
    }
  }

  getPriorityEmoji(priority) {
    switch (priority) {
      case "HIGH":
        return "🔴";
      case "MEDIUM":
        return "🟡";
      case "LOW":
        return "🟢";
      default:
        return "⚪️";
    }
  }

  async handleIncomingMessage(msg) {
    try {
      // Only process messages from authorized user
      if (msg.from.id.toString() !== config.telegram.userId) {
        logger.warn(`Unauthorized message from user ${msg.from.id}`);
        return;
      }

      const confirmationData = this.pendingConfirmations.get(msg.from.id);
      if (!confirmationData) {
        return;
      }

      // Add task completion handling
      if (confirmationData.type === "taskCompletion") {
        await this.handleTaskCompletionResponse(msg, confirmationData);
        return;
      }

      // Handle follow-up questions
      if (confirmationData.type === "followUp") {
        await this.handleFollowUpResponse(msg, confirmationData);
        return;
      }

      // Handle bulk archive confirmation
      if (confirmationData.type === "bulkArchive") {
        await this.handleBulkArchive(msg.from.id, msg.text, confirmationData);
        return;
      }

      const {
        emailId,
        action,
        draftResponse,
        originalEmail,
        editHistory = [],
      } = confirmationData;

      // Handle editing mode
      if (this.editingResponses.has(msg.from.id)) {
        await this.handleEditingResponse(msg, confirmationData);
        return;
      }

      await this.handleActionResponse(msg, confirmationData);
    } catch (error) {
      logger.error("Error handling incoming message", {
        error: error.message,
        userId: msg.from.id,
        messageText: msg.text,
      });
      await this.sendErrorMessage(msg.from.id);
    }
  }

  async handleFollowUpResponse(msg, confirmationData) {
    try {
      const { email, question, questionIndex, totalQuestions } =
        confirmationData;

      // Process the answer
      await aiService.processUserResponse(email, question, msg.text);

      if (questionIndex < totalQuestions.length - 1) {
        // More questions to ask
        await this.sendNextQuestion(
          msg.from.id,
          email,
          questionIndex + 1,
          totalQuestions
        );
      } else {
        // All questions answered, proceed with email analysis
        const analysis = await aiService.analyzeEmail(email);
        await this.sendConfirmation(msg.from.id, email, analysis);
      }
    } catch (error) {
      logger.error("Error handling follow-up response", {
        error: error.message,
      });
      await this.sendErrorMessage(msg.from.id);
    }
  }

  async handleEditingResponse(msg, confirmationData) {
    try {
      const {
        emailId,
        action,
        draftResponse,
        originalEmail,
        editHistory = [],
      } = confirmationData;

      editHistory.push({
        timestamp: new Date().toISOString(),
        content: msg.text,
      });

      const refinedResponse = await aiService.refineResponse(
        originalEmail,
        draftResponse,
        msg.text,
        editHistory
      );

      confirmationData.draftResponse = refinedResponse;
      confirmationData.editHistory = editHistory;

      this.editingResponses.delete(msg.from.id);
      await this.sendFinalConfirmationWithHistory(
        msg.from.id,
        confirmationData
      );
    } catch (error) {
      logger.error("Error handling editing response", { error: error.message });
      await this.sendErrorMessage(msg.from.id);
    }
  }

  async handleActionResponse(msg, confirmationData) {
    try {
      const { emailId, action, draftResponse, originalEmail } =
        confirmationData;

      switch (msg.text) {
        case "1":
          await this.executeConfirmedAction(msg.from.id, confirmationData);
          break;

        case "2":
          await this.bot.sendMessage(
            msg.from.id,
            "✅ Action cancelled. The email will remain unread."
          );
          this.pendingConfirmations.delete(msg.from.id);
          break;

        case "3":
          if (action === "RESPOND") {
            await this.initiateEditing(msg.from.id, confirmationData);
          } else {
            await this.handleForceReply(msg.from.id, confirmationData);
          }
          break;

        case "4":
          if (action === "RESPOND") {
            await this.handleForceArchive(msg.from.id, emailId);
          }
          break;

        default:
          logger.warn(`Unexpected response: ${msg.text}`);
          await this.sendErrorMessage(msg.from.id);
      }
    } catch (error) {
      logger.error("Error handling action response", {
        error: error.message,
        userId: msg.from.id,
        action: confirmationData?.action,
      });
      await this.sendErrorMessage(msg.from.id);
    }
  }

  async executeConfirmedAction(userId, confirmationData) {
    try {
      const { emailId, action, draftResponse, originalEmail } =
        confirmationData;

      if (!emailId || !action) {
        logger.error("Invalid confirmation data", { confirmationData });
        await this.sendErrorMessage(userId);
        this.pendingConfirmations.delete(userId);
        return;
      }

      switch (action) {
        case "RESPOND":
          if (!draftResponse) {
            logger.error("Missing draft response for RESPOND action");
            await this.sendErrorMessage(userId);
            break;
          }
          await emailService.sendResponse(emailId, draftResponse);
          await this.bot.sendMessage(userId, "✅ Response sent successfully!");
          break;

        case "ARCHIVE":
          try {
            // Check for similar emails before archiving
            const similarEmails = await emailService.findSimilarEmails(
              originalEmail
            );

            if (similarEmails && similarEmails.length > 0) {
              await this.askBulkArchiveConfirmation(
                userId,
                similarEmails,
                emailId,
                originalEmail
              );
              return; // Don't clear confirmation yet
            }

            await emailService.archiveEmail(emailId);
            await this.bot.sendMessage(
              userId,
              "✅ Email archived successfully!"
            );
          } catch (archiveError) {
            logger.error("Error in archive operation", {
              error: archiveError.message,
              emailId,
            });
            await this.sendErrorMessage(userId);
          }
          break;

        default:
          logger.warn(`Unknown action: ${action}`);
          await this.sendErrorMessage(userId);
          break;
      }

      // Clear the pending confirmation after successful execution
      this.pendingConfirmations.delete(userId);
    } catch (error) {
      logger.error("Error executing confirmed action", {
        error: error.message,
        userId,
        emailId: confirmationData?.emailId,
        action: confirmationData?.action,
      });
      await this.sendErrorMessage(userId);
      // Clean up the pending confirmation on error
      this.pendingConfirmations.delete(userId);
    }
  }

  async sendErrorMessage(userId) {
    try {
      await this.bot.sendMessage(
        userId,
        "❌ An error occurred. Please try again or contact support."
      );
    } catch (error) {
      logger.error("Error sending error message", { error: error.message });
    }
  }

  escapeSpecialChars(text) {
    if (!text) return "";
    return text
      .replace(/\\/g, "\\\\")
      .replace(/\./g, "\\.")
      .replace(/\!/g, "\\!")
      .replace(/\_/g, "\\_")
      .replace(/\*/g, "\\*")
      .replace(/\[/g, "\\[")
      .replace(/\]/g, "\\]")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)")
      .replace(/\~/g, "\\~")
      .replace(/\`/g, "\\`")
      .replace(/\>/g, "\\>")
      .replace(/\#/g, "\\#")
      .replace(/\+/g, "\\+")
      .replace(/\-/g, "\\-")
      .replace(/\=/g, "\\=")
      .replace(/\|/g, "\\|")
      .replace(/\{/g, "\\{")
      .replace(/\}/g, "\\}")
      .replace(/\&/g, "\\&");
  }

  async sendEditHistory(userId, editHistory) {
    let message = "*Edit History:*\n\n";
    editHistory.forEach((edit, index) => {
      const timestamp = new Date(edit.timestamp).toLocaleTimeString();
      message += `Edit ${index + 1} (${timestamp}):\n${this.escapeSpecialChars(
        edit.content
      )}\n\n`;
    });

    await this.bot.sendMessage(userId, message, {
      parse_mode: "Markdown",
    });
  }

  async sendFinalConfirmationWithHistory(userId, confirmationData) {
    try {
      const { draftResponse, editHistory } = confirmationData;

      let message = `
📧 *Confirm Final Response*

*Current Response:*
${this.escapeSpecialChars(draftResponse)}

${editHistory.length > 0 ? "\n*Edit History:*" : ""}
${editHistory
  .map((edit, index) => {
    const timestamp = new Date(edit.timestamp).toLocaleTimeString();
    return `\nEdit ${index + 1} (${timestamp}):\n${this.escapeSpecialChars(
      edit.content
    )}`;
  })
  .join("\n")}

Reply with:
1️⃣ to Confirm and Send
2️⃣ to Cancel
3️⃣ to Edit Again`;

      await this.bot.sendMessage(userId, message, {
        parse_mode: "Markdown",
        reply_markup: {
          keyboard: [["1", "2", "3"]],
          one_time_keyboard: true,
          resize_keyboard: true,
        },
      });
    } catch (error) {
      logger.error("Error sending final confirmation", {
        error: error.message,
        userId,
      });
      await this.sendErrorMessage(userId);
    }
  }

  async sendConfirmation(userId, emailData, analysis) {
    try {
      if (analysis.action === "NEED_INFO") {
        logger.info(`Additional information needed for email ${emailData.id}`);
        await this.sendNextQuestion(userId, emailData, 0, analysis.questions);
        return;
      }

      const summary = await aiService.summarizeThread(emailData);
      const message = `📧 *New Email Action Required*

*Subject:* ${this.escapeSpecialChars(emailData.subject || "No Subject")}
*From:* ${this.escapeSpecialChars(emailData.from || "Unknown")}

*Thread Summary:*
${this.escapeSpecialChars(summary)}

*Suggested Action:* ${this.escapeSpecialChars(analysis.action)}
*Reason:* ${this.escapeSpecialChars(analysis.reason)}

${
  analysis.action === "RESPOND"
    ? `*Proposed Response:*\n${this.escapeSpecialChars(analysis.draftResponse)}`
    : ""
}

Reply with:
1️⃣ to Confirm
2️⃣ to Reject
${
  analysis.action === "RESPOND"
    ? "3️⃣ to Edit Response\n4️⃣ to Force Archive"
    : "3️⃣ to Force Reply"
}`;

      const keyboard =
        analysis.action === "RESPOND"
          ? [["1", "2", "3", "4"]]
          : [["1", "2", "3"]];

      await this.bot.sendMessage(userId, message, {
        parse_mode: "MarkdownV2",
        reply_markup: {
          keyboard: keyboard,
          one_time_keyboard: true,
          resize_keyboard: true,
        },
      });

      this.pendingConfirmations.set(parseInt(userId), {
        emailId: emailData.id,
        action: analysis.action,
        draftResponse: analysis.draftResponse,
        originalEmail: emailData,
        editHistory: [],
      });

      logger.info(`Confirmation request sent for email ${emailData.id}`);
    } catch (error) {
      logger.error("Error sending confirmation", {
        error: error.message,
        userId,
        emailId: emailData?.id,
      });
      await this.sendErrorMessage(userId);
    }
  }

  async askBulkArchiveConfirmation(
    userId,
    similarEmails,
    originalEmailId,
    originalEmail
  ) {
    try {
      // Limit the number of similar emails shown
      const displayEmails = similarEmails.slice(0, 5); // Reduced to 5 for better formatting
      const totalCount = similarEmails.length;

      // Build message in parts to better control length
      const header = `📧 *Similar Emails Found*\n\nFound ${totalCount} similar emails${
        totalCount > 5 ? " (showing first 5)" : ""
      }\\.`;

      const originalSection = `\n\n*Original Email:*\nFrom: ${this.escapeSpecialChars(
        originalEmail.from
      )}\nSubject: ${this.escapeSpecialChars(originalEmail.subject)}`;

      // Build similar emails section with better formatting
      const similarSection = displayEmails
        .map(
          (email, index) =>
            `${index + 1}\\. *From:* ${this.escapeSpecialChars(
              email.from
            )}\n    *Subject:* ${this.escapeSpecialChars(email.subject)}`
        )
        .join("\n\n");

      const footer = `\n\nReply with:\n1️⃣ to Archive All \\(${totalCount} emails\\)\n2️⃣ to Archive Original Only\n3️⃣ to Select Individual Emails`;

      // Combine all parts
      const message = `${header}${originalSection}\n\n*Similar Emails:*\n${similarSection}${footer}`;

      // Send with proper error handling
      try {
        await this.bot.sendMessage(userId, message, {
          parse_mode: "MarkdownV2",
          reply_markup: {
            keyboard: [["1", "2", "3"]],
            one_time_keyboard: true,
            resize_keyboard: true,
          },
        });
      } catch (sendError) {
        // If the formatted message fails, try sending a simplified version
        const fallbackMessage = `📧 Similar Emails Found\n\nFound ${totalCount} similar emails. Would you like to archive them all?\n\n1️⃣ Archive All\n2️⃣ Archive Original Only\n3️⃣ Select Individual Emails`;

        await this.bot.sendMessage(userId, fallbackMessage, {
          reply_markup: {
            keyboard: [["1", "2", "3"]],
            one_time_keyboard: true,
            resize_keyboard: true,
          },
        });
      }

      // Store the confirmation data
      this.pendingConfirmations.set(parseInt(userId), {
        type: "bulkArchive",
        originalEmailId,
        originalEmail,
        similarEmails, // Store all emails for later use
      });
    } catch (error) {
      logger.error("Error sending bulk archive confirmation", {
        error: error.message,
        userId,
        emailCount: similarEmails?.length,
      });

      // Send a very simple fallback message
      await this.bot.sendMessage(
        userId,
        "Similar emails found. Reply:\n1 - Archive All\n2 - Archive Original\n3 - Select Individual",
        {
          reply_markup: {
            keyboard: [["1", "2", "3"]],
            one_time_keyboard: true,
            resize_keyboard: true,
          },
        }
      );

      // Still store the confirmation data
      this.pendingConfirmations.set(parseInt(userId), {
        type: "bulkArchive",
        originalEmailId,
        originalEmail,
        similarEmails,
      });
    }
  }

  async handleBulkArchive(userId, choice, confirmationData) {
    try {
      const { originalEmailId, similarEmails } = confirmationData;

      switch (choice) {
        case "1":
          // Archive all emails
          const allEmailIds = [
            originalEmailId,
            ...similarEmails.map((email) => email.id),
          ];

          logger.info(`Bulk archiving ${allEmailIds.length} emails`);
          const results = await emailService.bulkArchive(allEmailIds);

          const successCount = results.filter((r) => r.success).length;
          await this.bot.sendMessage(
            userId,
            `✅ Successfully archived ${successCount} emails!`
          );
          break;

        case "2":
          // Archive only original email
          logger.info(`Archiving only original email ${originalEmailId}`);
          await emailService.archiveEmail(originalEmailId);
          await this.bot.sendMessage(
            userId,
            "✅ Original email archived successfully!"
          );
          break;

        case "3":
          // Show individual selection interface
          await this.showEmailSelectionInterface(userId, confirmationData);
          return; // Don't clear pending confirmations yet

        default:
          logger.warn(`Unexpected bulk archive choice: ${choice}`);
          await this.sendErrorMessage(userId);
      }

      // Clear pending confirmations
      this.pendingConfirmations.delete(userId);
    } catch (error) {
      logger.error(`Error in bulk archive operation`, { error: error.message });
      await this.sendErrorMessage(userId);
      this.pendingConfirmations.delete(userId);
    }
  }

  async showEmailSelectionInterface(userId, confirmationData) {
    try {
      const { similarEmails } = confirmationData;
      const displayEmails = similarEmails.slice(0, 20);

      const message = `Select emails to archive \\(send numbers separated by commas\\):

${displayEmails
  .map(
    (email, index) =>
      `${index + 1}\\. From: ${this.escapeSpecialChars(email.from)}
Subject: ${this.escapeSpecialChars(email.subject)}`
  )
  .join("\n\n")}

Example: 1,3,4 to select those emails
Or type 'cancel' to abort${
        similarEmails.length > 20 ? "\n(Showing first 20 emails)" : ""
      }`;

      await this.bot.sendMessage(userId, message, {
        parse_mode: "MarkdownV2",
        reply_markup: {
          force_reply: true,
          remove_keyboard: true,
        },
      });

      confirmationData.type = "emailSelection";
      this.pendingConfirmations.set(userId, confirmationData);
    } catch (error) {
      logger.error("Error showing email selection interface", {
        error: error.message,
        userId,
      });
      await this.sendErrorMessage(userId);
      this.pendingConfirmations.delete(userId);
    }
  }

  clearPendingConfirmationsForEmails(emailIds) {
    // Clear any pending confirmations for the archived emails
    for (const [userId, confirmation] of this.pendingConfirmations.entries()) {
      if (confirmation.emailId && emailIds.includes(confirmation.emailId)) {
        this.pendingConfirmations.delete(userId);
      }
    }
  }

  async sendNextQuestion(userId, email, questionIndex, questions) {
    const message = `
❓ Additional Information Needed (${questionIndex + 1}/${questions.length})

${questions[questionIndex]}

Please provide your answer:`;

    await this.bot.sendMessage(userId, message, {
      reply_markup: {
        force_reply: true,
        remove_keyboard: true,
      },
    });

    // Store the question context
    this.pendingConfirmations.set(parseInt(userId), {
      type: "followUp",
      email,
      question: questions[questionIndex],
      questionIndex,
      totalQuestions: questions,
    });
  }

  async sendScheduledSummary() {
    try {
      const currentTime = new Date();
      logger.info(
        `Scheduled summary triggered at ${currentTime.toLocaleTimeString()}`
      );
      const summary = await summaryService.generateHourlySummary();
      await this.bot.sendMessage(config.telegram.userId, summary);
      logger.info("Scheduled summary sent successfully");
    } catch (error) {
      logger.error("Error sending scheduled summary", { error: error.message });
    }
  }

  async initiateEditing(userId, confirmationData) {
    try {
      // Create a simpler message with properly escaped characters
      const escapedResponse = this.escapeSpecialChars(
        confirmationData.draftResponse || ""
      );

      const message = [
        "📝 *Current Response:*",
        "",
        escapedResponse,
        "",
        "Please send your edited version\\.",
      ].join("\n");

      await this.bot.sendMessage(userId, message, {
        parse_mode: "MarkdownV2",
        reply_markup: {
          force_reply: true,
          remove_keyboard: true,
        },
      });

      this.editingResponses.set(userId, true);
    } catch (error) {
      logger.error("Error initiating editing", {
        error: error.message,
        userId,
        responseLength: confirmationData?.draftResponse?.length,
      });

      // Send a plain text fallback if markdown fails
      try {
        await this.bot.sendMessage(
          userId,
          "📝 Current Response:\n\n" +
            (confirmationData.draftResponse || "") +
            "\n\nPlease send your edited version.",
          {
            reply_markup: {
              force_reply: true,
              remove_keyboard: true,
            },
          }
        );
        this.editingResponses.set(userId, true);
      } catch (fallbackError) {
        logger.error("Error sending fallback edit message", {
          error: fallbackError.message,
        });
        await this.sendErrorMessage(userId);
        this.editingResponses.delete(userId);
      }
    }
  }

  async handleForceReply(userId, confirmationData) {
    try {
      const forcedResponse = await aiService.generateForcedResponse(
        confirmationData.originalEmail
      );
      confirmationData.action = "RESPOND";
      confirmationData.draftResponse = forcedResponse;
      await this.sendFinalConfirmationWithHistory(userId, confirmationData);
    } catch (error) {
      logger.error("Error handling force reply", { error: error.message });
      await this.sendErrorMessage(userId);
    }
  }

  async handleForceArchive(userId, emailId) {
    try {
      await emailService.archiveEmail(emailId);
      await this.bot.sendMessage(userId, "✅ Email archived successfully!");
      this.pendingConfirmations.delete(userId);
    } catch (error) {
      logger.error("Error handling force archive", { error: error.message });
      await this.sendErrorMessage(userId);
    }
  }

  async handleTasksCommand(msg) {
    try {
      const tasksByPriority = taskService.getTasksByPriority();
      const dueTasks = taskService.getDueTasks(7);
      const MAX_MESSAGE_LENGTH = 3000; // Reduced for safety
      const MAX_TASKS_PER_SECTION = 5; // Limit tasks shown in overview

      // Start with the header
      let currentMessage = "📋 *Task Management*\n\n";

      // Check if there are any tasks at all
      const hasNoTasks =
        tasksByPriority.HIGH.length === 0 &&
        tasksByPriority.MEDIUM.length === 0 &&
        tasksByPriority.LOW.length === 0 &&
        dueTasks.length === 0;

      if (hasNoTasks) {
        currentMessage +=
          "_No tasks found\\. Use the menu below to view different task categories\\._";
      } else {
        // Function to format task section with limits
        const formatTaskSection = (tasks, title) => {
          if (tasks.length === 0) return "";
          let section = `*${title}:* \\(${tasks.length} total\\)\n`;
          tasks.slice(0, MAX_TASKS_PER_SECTION).forEach((task, index) => {
            const safeDescription = this.escapeSpecialChars(
              task.description.length > 100
                ? task.description.substring(0, 97) + "..."
                : task.description
            );
            section += `${index + 1}\\. ${safeDescription}\n`;
          });
          if (tasks.length > MAX_TASKS_PER_SECTION) {
            section += `_\\.\\.\\. and ${
              tasks.length - MAX_TASKS_PER_SECTION
            } more_\n`;
          }
          return section + "\n";
        };

        // Add sections with counts
        if (tasksByPriority.HIGH.length > 0) {
          currentMessage += formatTaskSection(
            tasksByPriority.HIGH,
            "🔴 High Priority Tasks"
          );
        }

        if (tasksByPriority.MEDIUM.length > 0) {
          currentMessage += formatTaskSection(
            tasksByPriority.MEDIUM,
            "🟡 Medium Priority Tasks"
          );
        }

        if (dueTasks.length > 0) {
          currentMessage += formatTaskSection(dueTasks, "⏰ Due This Week");
        }
      }

      // Add help text
      currentMessage +=
        "\n_Use the buttons below to view complete task lists by category_";

      // Send message with buttons
      const keyboard = {
        inline_keyboard: [
          [
            { text: "📊 All Tasks", callback_data: "tasks_all" },
            { text: "⏰ Due Tasks", callback_data: "tasks_due" },
          ],
          [
            {
              text: `🔴 High (${tasksByPriority.HIGH.length})`,
              callback_data: "tasks_high",
            },
            {
              text: `🟡 Medium (${tasksByPriority.MEDIUM.length})`,
              callback_data: "tasks_medium",
            },
          ],
        ],
      };

      await this.bot.sendMessage(msg.chat.id, currentMessage, {
        parse_mode: "MarkdownV2",
        reply_markup: keyboard,
      });
    } catch (error) {
      logger.error("Error handling tasks command", {
        error: error.message,
        stack: error.stack,
      });

      // Send a simple fallback message
      await this.bot.sendMessage(
        msg.chat.id,
        "📋 Task Management\n\nSelect a category to view tasks:",
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "📊 All Tasks", callback_data: "tasks_all" },
                { text: "⏰ Due Tasks", callback_data: "tasks_due" },
              ],
              [
                { text: "🔴 High Priority", callback_data: "tasks_high" },
                { text: "🟡 Medium Priority", callback_data: "tasks_medium" },
              ],
            ],
          },
        }
      );
    }
  }

  async handleTaskDoneCommand(msg, match) {
    try {
      const taskId = match[1];
      await this.bot.sendMessage(
        msg.chat.id,
        'Add completion notes (or send "skip" to skip):',
        {
          reply_markup: {
            force_reply: true,
          },
        }
      );

      this.pendingConfirmations.set(msg.from.id, {
        type: "taskCompletion",
        taskId: taskId,
      });
    } catch (error) {
      logger.error("Error handling task done command", {
        error: error.message,
      });
      await this.sendErrorMessage(msg.chat.id);
    }
  }

  async handleTaskCompletionResponse(msg, confirmationData) {
    try {
      const { taskId } = confirmationData;
      const comment = msg.text.toLowerCase() === "skip" ? "" : msg.text;

      await taskService.updateTaskStatus(taskId, "COMPLETED", comment);

      await this.bot.sendMessage(
        msg.chat.id,
        "✅ Task marked as complete! Email notification has been sent.",
        {
          reply_markup: {
            remove_keyboard: true,
          },
        }
      );

      this.pendingConfirmations.delete(msg.from.id);
    } catch (error) {
      logger.error("Error handling task completion response", {
        error: error.message,
        taskId: confirmationData?.taskId,
      });
      await this.sendErrorMessage(msg.chat.id);
      this.pendingConfirmations.delete(msg.from.id);
    }
  }

  async notifyNewTasks(email, tasks) {
    try {
      const MAX_MESSAGE_LENGTH = 4096;
      let message = `📋 *New Tasks Extracted*\n\n`;
      message += `From Email: ${this.escapeSpecialChars(email.subject)}\n\n`;

      let currentMessage = message;

      tasks.forEach((task, index) => {
        const priority = this.getPriorityEmoji(task.priority);
        const deadline = task.deadline
          ? ` \\(Due: ${this.escapeSpecialChars(task.deadline)}\\)`
          : "";

        const taskLine = `${index + 1}\\. ${priority} ${this.escapeSpecialChars(
          task.description
        )}${deadline}\n`;

        // Check if adding this task would exceed the limit
        if ((currentMessage + taskLine).length > MAX_MESSAGE_LENGTH) {
          // Send current message
          this.bot.sendMessage(config.telegram.userId, currentMessage, {
            parse_mode: "MarkdownV2",
          });
          // Start new message with header
          currentMessage = message;
        }

        currentMessage += taskLine;
      });

      // Add final line
      currentMessage += "\n_Use /tasks to view all tasks_";

      // Send final message with button
      await this.bot.sendMessage(config.telegram.userId, currentMessage, {
        parse_mode: "MarkdownV2",
        reply_markup: {
          inline_keyboard: [
            [{ text: "📋 View Tasks", callback_data: "tasks_all" }],
          ],
        },
      });
    } catch (error) {
      logger.error("Error notifying about new tasks", {
        error: error.message,
        emailId: email.id,
        taskCount: tasks?.length,
      });
    }
  }

  async notifyTaskSummary(taskExtractionResults) {
    try {
      const MAX_MESSAGE_LENGTH = 4096; // Telegram's message length limit
      let summaryMessage = `📋 *Task Summary*\n\n`;
      let currentMessage = summaryMessage;

      for (const { email, tasks } of taskExtractionResults) {
        const emailSection =
          `*From:* ${this.escapeSpecialChars(email.from)}\n` +
          `*Subject:* ${this.escapeSpecialChars(email.subject)}\n\n`;

        // Check if adding email section would exceed limit
        if ((currentMessage + emailSection).length > MAX_MESSAGE_LENGTH) {
          // Send current message and start new one
          await this.bot.sendMessage(config.telegram.userId, currentMessage, {
            parse_mode: "MarkdownV2",
          });
          currentMessage = summaryMessage; // Reset with header
        }

        currentMessage += emailSection;

        for (const task of tasks) {
          const taskSection = `• ${this.getPriorityEmoji(
            task.priority
          )} ${this.escapeSpecialChars(task.description)}\n`;

          // Check if adding task would exceed limit
          if ((currentMessage + taskSection).length > MAX_MESSAGE_LENGTH) {
            // Send current message and start new one
            await this.bot.sendMessage(config.telegram.userId, currentMessage, {
              parse_mode: "MarkdownV2",
            });
            currentMessage = summaryMessage; // Reset with header
          }

          currentMessage += taskSection;
        }

        currentMessage += "\n"; // Add spacing between email sections
      }

      // Send any remaining message content
      if (currentMessage !== summaryMessage) {
        await this.bot.sendMessage(config.telegram.userId, currentMessage, {
          parse_mode: "MarkdownV2",
        });
      }

      // Send final message with action button
      await this.bot.sendMessage(
        config.telegram.userId,
        "_Use /tasks to view all tasks_",
        {
          parse_mode: "MarkdownV2",
          reply_markup: {
            inline_keyboard: [
              [{ text: "📋 View Tasks", callback_data: "tasks_all" }],
            ],
          },
        }
      );
    } catch (error) {
      logger.error("Error sending task summary notification", {
        error: error.message,
        taskGroupCount: taskExtractionResults?.length,
      });
    }
  }

  async handleStartProcessing(msg) {
    try {
      if (msg.from.id.toString() !== config.telegram.userId) {
        logger.warn(
          `Unauthorized start processing request from user ${msg.from.id}`
        );
        return;
      }

      const emailProcessor = require("../index");
      if (!emailProcessor.isProcessingEmails()) {
        // Reinitialize bot if needed
        if (!this.isInitialized) {
          await this.initialize();
        }

        await this.bot.sendMessage(
          msg.chat.id,
          "📧 Starting email processing..."
        );
        await emailProcessor.startEmailProcessing();
      } else {
        await this.bot.sendMessage(
          msg.chat.id,
          "📧 Email processing is already running"
        );
      }
    } catch (error) {
      logger.error("Error handling start processing command", {
        error: error.message,
      });
      await this.sendErrorMessage(msg.chat.id);
    }
  }

  async handleStopProcessing(msg) {
    try {
      if (msg.from.id.toString() !== config.telegram.userId) {
        logger.warn(
          `Unauthorized stop processing request from user ${msg.from.id}`
        );
        return;
      }

      const emailProcessor = require("../index");
      if (emailProcessor.isProcessingEmails()) {
        emailProcessor.stopEmailProcessing();
        await this.bot.sendMessage(msg.chat.id, "📧 Email processing stopped");
      } else {
        await this.bot.sendMessage(
          msg.chat.id,
          "📧 Email processing is not running"
        );
      }
    } catch (error) {
      logger.error("Error handling stop processing command", {
        error: error.message,
      });
      await this.sendErrorMessage(msg.chat.id);
    }
  }

  async handleProcessingStatus(msg) {
    try {
      if (msg.from.id.toString() !== config.telegram.userId) {
        logger.warn(`Unauthorized status request from user ${msg.from.id}`);
        return;
      }

      const emailProcessor = require("../index");
      const status = emailProcessor.isProcessingEmails()
        ? "🟢 Email processing is running"
        : "🔴 Email processing is stopped";

      await this.bot.sendMessage(msg.chat.id, status);
    } catch (error) {
      logger.error("Error handling processing status command", {
        error: error.message,
      });
      await this.sendErrorMessage(msg.chat.id);
    }
  }
}

// Add cleanup on process exit
process.on("SIGINT", async () => {
  const telegramService = require("./telegramService");
  await telegramService.cleanup();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  const telegramService = require("./telegramService");
  await telegramService.cleanup();
  process.exit(0);
});

module.exports = new TelegramService();
