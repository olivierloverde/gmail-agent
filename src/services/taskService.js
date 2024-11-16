const EventEmitter = require("events");
const logger = require("../utils/logger");
const emailService = require("./emailService");
const aiService = require("./aiService");
const dbService = require("./dbService");

class TaskService extends EventEmitter {
  constructor() {
    super();
    this.tasks = new Map(); // taskId -> task
    this.tasksByEmail = new Map(); // emailId -> taskIds[]
    this.similarityCache = new Map(); // taskId_taskId -> similarity score
  }

  async loadTaskFromDb(taskId) {
    try {
      const task = await dbService.getTaskById(taskId);
      if (task) {
        this.tasks.set(taskId, task);
        return task;
      }
      return null;
    } catch (error) {
      logger.error("Error loading task from database", {
        error: error.message,
        taskId,
      });
      return null;
    }
  }

  async updateTask(taskId, updatedData) {
    try {
      let task = this.tasks.get(taskId);
      if (!task) {
        task = await this.loadTaskFromDb(taskId);
        if (!task) {
          throw new Error(`Task ${taskId} not found`);
        }
      }

      const updatedTask = {
        ...task,
        ...updatedData,
        emailId: updatedData.emailId || task.email_id || task.emailId,
        threadId: updatedData.threadId || task.thread_id || task.threadId,
        updatedAt: new Date().toISOString(),
      };

      this.tasks.set(taskId, updatedTask);
      this.emit("task:updated", { task: updatedTask, oldTask: task });
      return updatedTask;
    } catch (error) {
      logger.error("Error updating task", {
        error: error.message,
        taskId,
      });
      throw error;
    }
  }

  async extractTasksFromEmail(email) {
    try {
      // Get existing tasks for this email from DB
      const existingTasks = await dbService.getTasksByEmailId(email.id);

      // Load existing tasks into memory
      existingTasks.forEach((task) => {
        this.tasks.set(task.id, task);
        const emailTasks = this.tasksByEmail.get(task.emailId) || [];
        if (!emailTasks.includes(task.id)) {
          emailTasks.push(task.id);
          this.tasksByEmail.set(task.emailId, emailTasks);
        }
      });

      // Extract new tasks
      const newTasks = await aiService.analyzeTasksInEmail(email);

      if (!newTasks || newTasks.length === 0) {
        logger.info("No new tasks found in email", { emailId: email.id });
        return [];
      }

      // Add email context to new tasks
      const tasksWithContext = newTasks.map((task) => ({
        ...task,
        emailId: email.id,
        threadId: email.threadId,
        from: email.from,
        subject: email.subject,
        context: {
          emailSubject: email.subject,
          emailFrom: email.from,
          emailBody: email.body,
          extractedAt: new Date().toISOString(),
        },
      }));

      // Process tasks in parallel batches
      const BATCH_SIZE = 5; // Process 5 tasks at a time
      const processedTasks = [];

      for (let i = 0; i < tasksWithContext.length; i += BATCH_SIZE) {
        const batch = tasksWithContext.slice(i, i + BATCH_SIZE);

        // Process each batch in parallel
        const batchResults = await Promise.all(
          batch.map(async (task) => {
            try {
              // Compare with existing tasks
              const comparisonResult = await aiService.compareTaskSets({
                existingTasks,
                newTasks: [task], // Compare one task at a time
                threadContext: {
                  subject: email.subject,
                  from: email.from,
                  body: email.body,
                },
              });

              const result = comparisonResult[0]; // Get first result since we only sent one task

              if (result.action === "CREATE") {
                const createdTask = await this.createTask({
                  ...result.task,
                  emailId: email.id,
                  threadId: email.threadId,
                  from: email.from,
                  subject: email.subject,
                });
                logger.info("Created new task", {
                  taskId: createdTask.id,
                  description: createdTask.description,
                });
                return createdTask;
              } else if (result.action === "UPDATE") {
                const updatedTask = await this.updateTask(
                  result.existingTaskId,
                  {
                    ...result.updatedTask,
                    emailId: email.id,
                    threadId: email.threadId,
                    from: email.from,
                    subject: email.subject,
                  }
                );
                logger.info("Updated existing task", {
                  taskId: updatedTask.id,
                  description: updatedTask.description,
                });
                return updatedTask;
              }
              return null;
            } catch (error) {
              logger.error("Error processing task in batch", {
                error: error.message,
                taskDescription: task.description,
              });
              return null;
            }
          })
        );

        // Add successful results to processed tasks
        processedTasks.push(...batchResults.filter((task) => task !== null));
      }

      return processedTasks;
    } catch (error) {
      logger.error("Error extracting tasks from email", {
        error: error.message,
        emailId: email.id,
      });
      throw error;
    }
  }

  async createTask(taskData) {
    try {
      const taskId =
        taskData.id ||
        `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const task = {
        id: taskId,
        ...taskData,
        // Ensure email context is properly set
        emailId: taskData.emailId,
        threadId: taskData.threadId,
        from: taskData.from || taskData.from_address,
        subject: taskData.subject,
        context: taskData.context || {},
        status: taskData.status || "PENDING",
        createdAt: taskData.createdAt || new Date().toISOString(),
        updatedAt: taskData.updatedAt || new Date().toISOString(),
      };

      this.tasks.set(taskId, task);

      if (task.emailId) {
        const emailTasks = this.tasksByEmail.get(task.emailId) || [];
        emailTasks.push(taskId);
        this.tasksByEmail.set(task.emailId, emailTasks);
      }

      this.emit("task:created", task);
      return task;
    } catch (error) {
      logger.error("Error creating task", { error: error.message });
      throw error;
    }
  }

  async updateTaskStatus(taskId, status, comment) {
    try {
      const task = this.tasks.get(taskId);
      if (!task) {
        throw new Error(`Task ${taskId} not found`);
      }

      const oldStatus = task.status;
      task.status = status;
      task.updatedAt = new Date().toISOString();

      if (comment) {
        task.comments = task.comments || [];
        task.comments.push({
          content: comment,
          timestamp: new Date().toISOString(),
        });
      }

      this.tasks.set(taskId, task);
      this.emit("task:updated", { task, oldStatus });

      // If task is completed, send email update
      if (status === "COMPLETED" && task.emailId) {
        await this.sendTaskCompletionEmail(task, comment);
      }

      return task;
    } catch (error) {
      logger.error("Error updating task status", {
        error: error.message,
        taskId,
      });
      throw error;
    }
  }

  async getTasks(filter = {}) {
    try {
      let tasks = Array.from(this.tasks.values());

      // Apply filters
      if (filter.status) {
        tasks = tasks.filter((task) => task.status === filter.status);
      }
      if (filter.priority) {
        tasks = tasks.filter((task) => task.priority === filter.priority);
      }
      if (filter.deadline) {
        const filterDate = new Date(filter.deadline);
        if (!isNaN(filterDate.getTime())) {
          tasks = tasks.filter((task) => {
            if (!task.deadline) return false;
            const taskDate = new Date(task.deadline);
            return !isNaN(taskDate.getTime()) && taskDate <= filterDate;
          });
        }
      }
      if (filter.emailId) {
        tasks = tasks.filter((task) => task.emailId === filter.emailId);
      }

      // Sort by priority and deadline
      tasks.sort((a, b) => {
        // First sort by priority
        const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
        const priorityDiff =
          priorityOrder[a.priority] - priorityOrder[b.priority];
        if (priorityDiff !== 0) return priorityDiff;

        // Then sort by deadline if both have valid dates
        const dateA = a.deadline ? new Date(a.deadline) : null;
        const dateB = b.deadline ? new Date(b.deadline) : null;

        if (!dateA && !dateB) return 0;
        if (!dateA) return 1;
        if (!dateB) return -1;

        if (isNaN(dateA.getTime()) || isNaN(dateB.getTime())) return 0;
        return dateA.getTime() - dateB.getTime();
      });

      return tasks;
    } catch (error) {
      logger.error("Error getting tasks", { error: error.message });
      throw error;
    }
  }

  async sendTaskCompletionEmail(task, comment) {
    try {
      const completionMessage = `
Task Completed: ${task.description}
Status: Completed
${comment ? `Completion Notes: ${comment}` : ""}
${task.deadline ? `Original Deadline: ${task.deadline}` : ""}
Completed At: ${new Date().toISOString()}

This is an automated update regarding the task from our previous communication.`;

      await emailService.sendResponse(task.emailId, completionMessage);
      logger.info(`Sent completion email for task ${task.id}`);
    } catch (error) {
      logger.error("Error sending task completion email", {
        error: error.message,
        taskId: task.id,
      });
      // Don't throw - we don't want to break task completion if email fails
    }
  }

  getTasksByPriority() {
    const tasksByPriority = {
      HIGH: [],
      MEDIUM: [],
      LOW: [],
    };

    for (const task of this.tasks.values()) {
      if (task.status !== "COMPLETED") {
        tasksByPriority[task.priority].push(task);
      }
    }

    return tasksByPriority;
  }

  getDueTasks(days = 7) {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + days);

    return Array.from(this.tasks.values()).filter((task) => {
      if (task.status === "COMPLETED" || !task.deadline) return false;
      return new Date(task.deadline) <= dueDate;
    });
  }

  async createTaskFromEmail(email, taskDescription, priority = "MEDIUM") {
    try {
      const task = {
        description: taskDescription,
        emailId: email.id,
        threadId: email.threadId,
        from: email.from,
        subject: email.subject,
        priority: priority,
        status: "PENDING",
        createdAt: new Date().toISOString(),
        deadline: null, // You can add logic to extract deadline from email if needed
      };

      return await this.createTask(task);
    } catch (error) {
      logger.error("Error creating task from email", {
        error: error.message,
        emailId: email.id,
      });
      throw error;
    }
  }

  async optimizeTaskList(taskExtractionResults) {
    try {
      // Group similar tasks
      const groupedTasks = await this.groupSimilarTasks(taskExtractionResults);

      // Update task relationships
      for (const group of groupedTasks) {
        if (group.length > 1) {
          // Create a parent task for the group
          const parentTask = await this.createParentTask(group);

          // Update all tasks in the group to reference the parent
          for (const task of group) {
            task.parentTaskId = parentTask.id;
            task.isSubtask = true;
            await this.updateTask(task.id, task);
          }
        }
      }

      // Sort and prioritize tasks
      await this.prioritizeTasks(taskExtractionResults);

      return groupedTasks;
    } catch (error) {
      logger.error("Error optimizing task list", { error: error.message });
      throw error;
    }
  }

  async groupSimilarTasks(taskExtractionResults) {
    try {
      const groups = [];
      const processedTasks = new Set();
      const allTasks = taskExtractionResults.flatMap((r) => r.tasks);

      // Pre-compute similarities in batches
      const batchSize = 5; // Process 5 task pairs at a time
      const similarities = new Map();

      for (let i = 0; i < allTasks.length; i++) {
        const task = allTasks[i];
        if (processedTasks.has(task.id)) continue;

        const comparisons = [];
        for (let j = i + 1; j < allTasks.length; j++) {
          const otherTask = allTasks[j];
          if (processedTasks.has(otherTask.id)) continue;

          const cacheKey = this.getSimilarityCacheKey(task.id, otherTask.id);
          if (this.similarityCache.has(cacheKey)) {
            similarities.set(cacheKey, this.similarityCache.get(cacheKey));
          } else {
            comparisons.push({ task, otherTask, cacheKey });
          }
        }

        // Process comparisons in batches
        for (let j = 0; j < comparisons.length; j += batchSize) {
          const batch = comparisons.slice(j, j + batchSize);
          const results = await Promise.all(
            batch.map(async ({ task, otherTask, cacheKey }) => {
              const similarity = await aiService.compareTaskSimilarity(
                task.description,
                otherTask.description
              );
              return { cacheKey, similarity };
            })
          );

          // Store results in cache and similarities map
          results.forEach(({ cacheKey, similarity }) => {
            this.similarityCache.set(cacheKey, similarity);
            similarities.set(cacheKey, similarity);
          });
        }
      }

      // Group tasks based on pre-computed similarities
      for (const task of allTasks) {
        if (processedTasks.has(task.id)) continue;

        const similarTasks = allTasks.filter((otherTask) => {
          if (otherTask.id === task.id || processedTasks.has(otherTask.id))
            return false;
          const similarity = similarities.get(
            this.getSimilarityCacheKey(task.id, otherTask.id)
          );
          return similarity > 0.8;
        });

        if (similarTasks.length > 0) {
          groups.push([task, ...similarTasks]);
          processedTasks.add(task.id);
          similarTasks.forEach((t) => processedTasks.add(t.id));
        } else {
          groups.push([task]);
          processedTasks.add(task.id);
        }
      }

      return groups;
    } catch (error) {
      logger.error("Error grouping similar tasks", { error: error.message });
      return allTasks.map((task) => [task]); // Fallback: each task in its own group
    }
  }

  getSimilarityCacheKey(taskId1, taskId2) {
    // Ensure consistent key regardless of task order
    return [taskId1, taskId2].sort().join("_");
  }

  // Add method to clear cache if needed
  clearSimilarityCache() {
    this.similarityCache.clear();
  }

  async createParentTask(taskGroup) {
    try {
      // Create a parent task that encompasses all similar tasks
      const parentDescription = await aiService.generateParentTaskDescription(
        taskGroup
      );

      const deadline = this.getEarliestDeadline(taskGroup);
      const priority = this.getHighestPriority(taskGroup);

      const parentTask = {
        description: parentDescription,
        priority: priority,
        deadline: deadline, // Now properly handled
        isParent: true,
        childTaskIds: taskGroup.map((t) => t.id),
        status: "PENDING",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      return await this.createTask(parentTask);
    } catch (error) {
      logger.error("Error creating parent task", {
        error: error.message,
        taskCount: taskGroup?.length,
      });

      // Create a basic parent task if there's an error
      return await this.createTask({
        description: `Combined task group (${taskGroup.length} tasks)`,
        priority: "MEDIUM",
        deadline: null,
        isParent: true,
        childTaskIds: taskGroup.map((t) => t.id),
        status: "PENDING",
      });
    }
  }

  async prioritizeTasks(taskExtractionResults) {
    // Analyze dependencies and adjust priorities
    const allTasks = taskExtractionResults.flatMap((r) => r.tasks);

    for (const task of allTasks) {
      if (task.dependencies && task.dependencies.length > 0) {
        // Ensure dependent tasks have appropriate priority
        const dependentTasks = allTasks.filter((t) =>
          task.dependencies.includes(t.description)
        );

        for (const depTask of dependentTasks) {
          if (
            this.getPriorityValue(depTask.priority) >
            this.getPriorityValue(task.priority)
          ) {
            // Increase priority of dependent task
            await this.updateTask(depTask.id, {
              ...depTask,
              priority: task.priority,
            });
          }
        }
      }
    }
  }

  getPriorityValue(priority) {
    const priorityMap = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    return priorityMap[priority] || 3;
  }

  getHighestPriority(tasks) {
    return tasks.reduce(
      (highest, task) =>
        this.getPriorityValue(task.priority) < this.getPriorityValue(highest)
          ? task.priority
          : highest,
      "LOW"
    );
  }

  getEarliestDeadline(tasks) {
    try {
      const validDeadlines = tasks
        .map((t) => t.deadline)
        .filter((d) => d && !isNaN(new Date(d).getTime()));

      if (validDeadlines.length === 0) return null;

      const earliestDate = new Date(
        Math.min(...validDeadlines.map((d) => new Date(d).getTime()))
      );

      // Check if the date is valid before converting to ISO string
      return !isNaN(earliestDate.getTime()) ? earliestDate.toISOString() : null;
    } catch (error) {
      logger.error("Error getting earliest deadline", {
        error: error.message,
        deadlines: tasks.map((t) => t.deadline),
      });
      return null;
    }
  }
}

module.exports = new TaskService();
