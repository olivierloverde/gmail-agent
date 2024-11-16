const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const path = require("path");
const logger = require("../utils/logger");
const EventEmitter = require("events");

class DBService extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.isInitialized = false;
    this.taskService = null; // Will be set during initialization
  }

  setTaskService(taskService) {
    this.taskService = taskService;
    // Register event listeners
    this.taskService.on("task:created", this.handleTaskCreated.bind(this));
    this.taskService.on("task:updated", this.handleTaskUpdated.bind(this));
  }

  async initialize() {
    try {
      if (this.isInitialized) {
        logger.info("Database already initialized");
        return;
      }

      // Open database connection
      this.db = await open({
        filename: path.join(process.cwd(), "data", "tasks.db"),
        driver: sqlite3.Database,
      });

      // Create tasks table if it doesn't exist
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          email_id TEXT,
          thread_id TEXT,
          from_address TEXT,
          subject TEXT,
          description TEXT,
          deadline TEXT,
          priority TEXT,
          dependencies TEXT,
          context TEXT,
          status TEXT,
          created_at TEXT,
          updated_at TEXT,
          parent_task_id TEXT,
          is_subtask INTEGER DEFAULT 0,
          is_parent INTEGER DEFAULT 0,
          child_task_ids TEXT,
          comments TEXT
        )
      `);

      this.isInitialized = true;
      logger.info("Database service initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize database service", {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  async taskExists(taskId) {
    try {
      const result = await this.db.get("SELECT id FROM tasks WHERE id = ?", [
        taskId,
      ]);
      return !!result;
    } catch (error) {
      logger.error("Error checking task existence", {
        error: error.message,
        taskId,
      });
      return false;
    }
  }

  async getTasksByThreadId(threadId) {
    try {
      const tasks = await this.db.all(
        `SELECT * FROM tasks WHERE thread_id = ? AND status != 'COMPLETED'`,
        [threadId]
      );
      return tasks.map((task) => ({
        ...task,
        dependencies: JSON.parse(task.dependencies || "[]"),
        context: JSON.parse(task.context || "{}"),
        childTaskIds: JSON.parse(task.child_task_ids || "[]"),
        comments: JSON.parse(task.comments || "[]"),
      }));
    } catch (error) {
      logger.error("Error getting tasks by thread ID", {
        error: error.message,
        threadId,
      });
      return [];
    }
  }

  async handleTaskCreated(task) {
    try {
      // Check for existing tasks from the same thread with similar description
      const existingTasks = await this.getTasksByThreadId(task.threadId);
      const exists = existingTasks.some(
        (existingTask) =>
          existingTask.description.toLowerCase().trim() ===
          task.description.toLowerCase().trim()
      );

      if (exists) {
        logger.info(
          "Similar task already exists in thread, skipping creation",
          {
            taskId: task.id,
            description: task.description,
            threadId: task.threadId,
          }
        );
        return;
      }

      await this.db.run(
        `INSERT INTO tasks (
          id, email_id, thread_id, from_address, subject, description,
          deadline, priority, dependencies, context, status,
          created_at, updated_at, parent_task_id, is_subtask,
          is_parent, child_task_ids, comments
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          task.id,
          task.emailId || null,
          task.threadId || null,
          task.from || null,
          task.subject || null,
          task.description,
          task.deadline || null,
          task.priority,
          JSON.stringify(task.dependencies || []),
          JSON.stringify(task.context || {}),
          task.status,
          task.createdAt,
          task.updatedAt,
          task.parentTaskId || null,
          task.isSubtask ? 1 : 0,
          task.isParent ? 1 : 0,
          JSON.stringify(task.childTaskIds || []),
          JSON.stringify(task.comments || []),
        ]
      );

      logger.info("Task created in database", {
        taskId: task.id,
        description: task.description,
      });
    } catch (error) {
      logger.error("Error creating task in database", {
        error: error.message,
        taskId: task.id,
        description: task.description,
      });
    }
  }

  async handleTaskUpdated({ task, oldStatus }) {
    try {
      const result = await this.db.get("SELECT id FROM tasks WHERE id = ?", [
        task.id,
      ]);

      if (!result) {
        logger.warn("Attempted to update non-existent task", {
          taskId: task.id,
        });
        await this.handleTaskCreated(task);
        return;
      }

      // Get the existing task to preserve IDs if they're not in the update
      const existingTask = await this.getTaskById(task.id);

      await this.db.run(
        `UPDATE tasks SET
          email_id = ?,
          thread_id = ?,
          from_address = ?,
          subject = ?,
          description = ?,
          deadline = ?,
          priority = ?,
          dependencies = ?,
          context = ?,
          status = ?,
          updated_at = ?,
          parent_task_id = ?,
          is_subtask = ?,
          is_parent = ?,
          child_task_ids = ?,
          comments = ?
        WHERE id = ?`,
        [
          task.emailId || task.email_id || existingTask.email_id,
          task.threadId || task.thread_id || existingTask.thread_id,
          task.from || existingTask.from_address,
          task.subject || existingTask.subject,
          task.description,
          task.deadline || null,
          task.priority,
          JSON.stringify(task.dependencies || []),
          JSON.stringify(task.context || {}),
          task.status,
          task.updatedAt,
          task.parentTaskId || task.parent_task_id || null,
          task.isSubtask || task.is_subtask ? 1 : 0,
          task.isParent || task.is_parent ? 1 : 0,
          JSON.stringify(task.childTaskIds || task.child_task_ids || []),
          JSON.stringify(task.comments || []),
          task.id,
        ]
      );

      logger.info("Task updated in database", {
        taskId: task.id,
        description: task.description,
        status: task.status,
        emailId: task.emailId || task.email_id,
        threadId: task.threadId || task.thread_id,
      });
    } catch (error) {
      logger.error("Error updating task in database", {
        error: error.message,
        taskId: task.id,
        description: task.description,
      });
    }
  }

  async cleanup() {
    try {
      if (this.db) {
        await this.db.close();
        this.db = null;
        this.isInitialized = false;
        logger.info("Database connection closed");
      }
    } catch (error) {
      logger.error("Error closing database connection", {
        error: error.message,
      });
    }
  }

  async getTasksByEmailId(emailId) {
    try {
      const tasks = await this.db.all(
        `SELECT * FROM tasks WHERE email_id = ? AND status != 'COMPLETED'`,
        [emailId]
      );
      return tasks.map((task) => ({
        ...task,
        dependencies: JSON.parse(task.dependencies || "[]"),
        context: JSON.parse(task.context || "{}"),
        childTaskIds: JSON.parse(task.child_task_ids || "[]"),
        comments: JSON.parse(task.comments || "[]"),
      }));
    } catch (error) {
      logger.error("Error getting tasks by email ID", {
        error: error.message,
        emailId,
      });
      return [];
    }
  }

  async getTaskById(taskId) {
    try {
      const task = await this.db.get("SELECT * FROM tasks WHERE id = ?", [
        taskId,
      ]);

      if (!task) return null;

      return {
        ...task,
        dependencies: JSON.parse(task.dependencies || "[]"),
        context: JSON.parse(task.context || "{}"),
        childTaskIds: JSON.parse(task.child_task_ids || "[]"),
        comments: JSON.parse(task.comments || "[]"),
        isSubtask: !!task.is_subtask,
        isParent: !!task.is_parent,
      };
    } catch (error) {
      logger.error("Error getting task by ID", {
        error: error.message,
        taskId,
      });
      return null;
    }
  }
}

module.exports = new DBService();
