const { ChatOpenAI } = require("@langchain/openai");
const { PromptTemplate } = require("@langchain/core/prompts");
const config = require("../config/config");
const userService = require("./userService");
const logger = require("../utils/logger");
const contextService = require("./contextService");

class AIService {
  constructor() {
    this.model = new ChatOpenAI({
      openAIApiKey: config.openai.apiKey,
      temperature: 0.7,
      modelName: "gpt-4o-mini",
    });
  }

  async summarizeThread(email) {
    const prompt = PromptTemplate.fromTemplate(
      `Analyze and summarize this email thread, with special emphasis on the most recent messages:

Subject: {subject}
From: {from}
Content: {body}

Provide a concise summary (max 3 lines) that:
1. Identifies the most recent development or latest request (HIGHEST PRIORITY)
2. Provides essential context from earlier messages (if relevant)
3. Highlights any pending actions or time-sensitive matters

Format your summary to clearly distinguish between:
- LATEST: [Most recent email's key points]
- CONTEXT: [Brief relevant history if needed]

Keep the summary focused and prioritize the most recent communication while providing just enough context to understand the situation.`
    );

    const formattedPrompt = await prompt.format({
      subject: email.subject,
      from: email.from,
      body: email.body,
    });

    const response = await this.model.invoke(formattedPrompt);
    return response.content.trim();
  }

  async analyzeEmail(email, isFollowUp = false) {
    try {
      const userData = await userService.getUserData();
      const relevantContext = await contextService.getRelevantContext(email);

      // Only check for additional info if this is not a follow-up
      if (!isFollowUp) {
        const needsMoreInfo = await this.checkIfNeedsMoreInfo(
          email,
          relevantContext
        );

        if (needsMoreInfo.needed) {
          logger.info(`Additional information needed for email ${email.id}`);
          return {
            action: "NEED_INFO",
            questions: needsMoreInfo.questions,
            context: needsMoreInfo.context,
            originalEmail: email,
          };
        }
      }

      // Regular email analysis with context
      const prompt = new PromptTemplate({
        template: `You are an intelligent email assistant for {firstName} {lastName}. 

Available Context:
{context}

First, analyze this email:
Subject: {subject}
From: {from}
Email Content: {body}

Classification Guidelines:
1. ALWAYS ARCHIVE if the email is:
   - An automated notification or alert
   - A newsletter or marketing email
   - A system-generated message
   - A notification from a service
   - A delivery status or tracking update
   - A calendar invitation or update
   - A subscription confirmation
   - An automated receipt or invoice
   - A social media notification
   - A promotional offer
   - A "no-reply" sender address

2. Consider RESPOND only if ALL these conditions are met:
   - The email is from a real person (not automated)
   - It contains a direct question or request requiring action
   - It's a personal or business communication needing human interaction
   - It's not part of an automated workflow
   - It requires your specific input or decision

Task:
1. Use the available context to inform your decision
2. Apply the classification guidelines strictly
3. If response is needed, use context to make it more relevant

Provide your analysis using EXACTLY this format:

Action: ARCHIVE or RESPOND
Reason: [Clear explanation in English why this should be archived or requires response]
Draft Response: [If action is RESPOND, provide your response using available context]

Important:
- Be very conservative about suggesting responses
- When in doubt, choose ARCHIVE
- Notifications should ALWAYS be archived
{signatureInstruction}

Double-check your classification before responding.`,
        inputVariables: [
          "firstName",
          "lastName",
          "context",
          "subject",
          "from",
          "body",
          "signatureInstruction",
        ],
      });

      const formattedPrompt = await prompt.format({
        firstName: userData.firstName,
        lastName: userData.lastName || "",
        context: JSON.stringify(relevantContext, null, 2),
        subject: email.subject,
        from: email.from,
        body: email.body,
        signatureInstruction: userData.preferences.useSignature
          ? `- Include this signature in responses:\n${userData.signature}`
          : "",
      });

      const response = await this.model.invoke(formattedPrompt);
      return this.parseAIResponse(response.content);
    } catch (error) {
      logger.error(`Error analyzing email`, {
        error: error.message,
        emailId: email.id,
      });
      throw error;
    }
  }

  async checkIfNeedsMoreInfo(email, existingContext) {
    try {
      // First check if we already have sufficient context
      const userData = await userService.getUserData();
      const allContext = {
        ...existingContext,
        userData: {
          firstName: userData.firstName,
          lastName: userData.lastName,
          preferences: userData.preferences,
        },
      };

      const contextStr = JSON.stringify(allContext, null, 2);

      const prompt = new PromptTemplate({
        template: `You are an intelligent email assistant. Review this email and the available context to determine if additional information is truly needed.

Available Context:
{context}

Email Details:
Subject: {subject}
From: {from}
Content: {body}

Important Guidelines:
1. Check if the required information exists in the available context
2. Only request additional information if it's ABSOLUTELY necessary
3. Before asking for information, verify it's not already provided in:
   - The user data
   - The existing context
   - The email content itself
4. Consider if the email can be handled with current context

You must respond in exactly this format:
NEEDED: [true/false]
QUESTIONS: [comma-separated list of questions if needed]
CONTEXT_INFO: [category]|[key]|[importance]

Note: Only return NEEDED: true if the information is absolutely essential and not available in any form in the current context.`,
        inputVariables: ["context", "subject", "from", "body"],
      });

      const formattedPrompt = await prompt.format({
        subject: email.subject,
        from: email.from,
        body: email.body,
        context: contextStr,
      });

      const response = await this.model.invoke(formattedPrompt);

      if (!response || !response.content) {
        logger.error("Invalid response from AI model", { emailId: email.id });
        return { needed: false, questions: [], context: {} };
      }

      const content = response.content.trim();
      const lines = content.split("\n").filter((line) => line.trim());

      if (lines.length < 3) {
        logger.error("Incomplete response format from AI model", {
          emailId: email.id,
          response: content,
        });
        return { needed: false, questions: [], context: {} };
      }

      // Safely parse each line with error handling
      let needed = false;
      let questions = [];
      let category = "",
        key = "",
        importance = "";

      try {
        // Parse NEEDED line
        const neededLine = lines[0].split(":")[1];
        if (neededLine) {
          needed = neededLine.trim().toLowerCase() === "true";
        }

        // Parse QUESTIONS line
        const questionsLine = lines[1].split(":")[1];
        if (questionsLine) {
          const questionsStr = questionsLine.trim();
          questions =
            questionsStr === "[]"
              ? []
              : questionsStr
                  .split(",")
                  .map((q) => q.trim())
                  .filter((q) => q);
        }

        // Parse CONTEXT_INFO line
        const contextLine = lines[2].split(":")[1];
        if (contextLine) {
          const contextParts = contextLine.trim().split("|");
          if (contextParts.length === 3) {
            [category, key, importance] = contextParts.map((part) =>
              part.trim()
            );
          }
        }
      } catch (parseError) {
        logger.error("Error parsing AI response", {
          error: parseError.message,
          emailId: email.id,
          response: content,
        });
        return { needed: false, questions: [], context: {} };
      }

      return {
        needed,
        questions,
        context: {
          category,
          key,
          importance,
        },
      };
    } catch (error) {
      logger.error("Error checking for needed information", {
        error: error.message,
        emailId: email.id,
      });
      return { needed: false, questions: [], context: {} };
    }
  }

  async processUserResponse(email, question, answer) {
    try {
      const prompt = new PromptTemplate({
        template: `Based on this question and answer, help categorize and structure the information for future use.

Question: {question}
Answer: {answer}

Determine:
1. The appropriate category (projectInfo/contacts/terminology/preferences)
2. The key under which to store this information
3. Any related terms or aliases that should trigger this context

Return your response in this exact format:
CATEGORY: [category name]
KEY: [storage key]
VALUE: [processed answer]
ALIASES: [alias1], [alias2], [alias3]`,
        inputVariables: ["question", "answer"],
      });

      const formattedPrompt = await prompt.format({
        question: question,
        answer: answer,
      });

      const response = await this.model.invoke(formattedPrompt);

      // Parse the response
      const lines = response.content.trim().split("\n");
      const result = {};

      for (const line of lines) {
        const [key, value] = line.split(":").map((s) => s.trim());
        if (key === "ALIASES") {
          result.aliases = value
            .split(",")
            .map((a) => a.trim())
            .filter((a) => a);
        } else {
          result[key.toLowerCase()] = value;
        }
      }

      // Store the information
      await contextService.addContext(
        result.category,
        result.key,
        result.value
      );

      // Store aliases
      for (const alias of result.aliases) {
        await contextService.addContext(result.category, alias, result.value);
      }

      return result;
    } catch (error) {
      console.info(error);
      logger.error("Error processing user response", {
        error: error.message,
        question,
        answer,
      });
      throw error;
    }
  }

  async generateForcedResponse(email) {
    // First, detect the language
    const languagePrompt = PromptTemplate.fromTemplate(
      `Analyze the language of this email:

Subject: {subject}
From: {from}
Content: {body}

Return ONLY the language code (e.g., "en" for English, "fr" for French, etc.).`
    );

    const languageResponse = await this.model.invoke(
      await languagePrompt.format({
        subject: email.subject,
        from: email.from,
        body: email.body,
      })
    );

    const detectedLanguage = languageResponse.content.trim().toLowerCase();

    const prompt = PromptTemplate.fromTemplate(
      `Generate a professional response to this email. The original email is in ${detectedLanguage} language.

Subject: {subject}
From: {from}
Content: {body}

Guidelines for response:
1. MUST write the response in the SAME LANGUAGE as the original email (${detectedLanguage})
2. Be professional and courteous
3. Address all points in the email
4. Maintain appropriate tone and formality
5. Keep the response clear and concise
6. Match the style and formality level of the original email

Important:
- Your response MUST be in ${detectedLanguage}
- Match the tone and formality of the original email
- Use appropriate business etiquette for ${detectedLanguage}

Generate only the response text without any additional commentary.`
    );

    const formattedPrompt = await prompt.format({
      subject: email.subject,
      from: email.from,
      body: email.body,
    });

    const response = await this.model.invoke(formattedPrompt);
    return response.content.trim();
  }

  async refineResponse(
    originalEmail,
    originalResponse,
    userModification,
    editHistory = []
  ) {
    const prompt = PromptTemplate.fromTemplate(
      `You are an intelligent email assistant.

First, explicitly identify the language of this email:
Subject: {subject}
From: {from}
Email Content: {body}

Important Language Rules:
1. If the original email is in English:
   - You MUST write your refined response in English
   - Follow English business communication standards
2. If the original email is in another language:
   - Write the refined response in that same language
   - Follow appropriate business standards for that language

Original AI Response:
{originalResponse}

Edit History:
{editHistory}

Latest User Modification:
{userModification}

Task:
Create a refined response that:
1. STRICTLY follows the language rules based on the original email
2. Incorporates user modifications while maintaining appropriate business etiquette
3. Preserves key points from the original email and previous edits
4. Uses proper formal communication style for the detected language
5. Maintains cultural appropriateness

Important:
- Double-check that your response is in the SAME LANGUAGE as the original email
- Match the tone and formality of the original email
- Ensure cultural relevance for the detected language

Provide only the refined response without any additional commentary.`
    );

    const formattedPrompt = await prompt.format({
      subject: originalEmail.subject,
      from: originalEmail.from,
      body: originalEmail.body,
      originalResponse: originalResponse,
      editHistory:
        editHistory.length > 0
          ? editHistory
              .map(
                (edit, index) =>
                  `Edit ${index + 1} (${new Date(
                    edit.timestamp
                  ).toLocaleString()}):\n${edit.content}`
              )
              .join("\n\n")
          : "No previous edits",
      userModification: userModification,
    });

    const response = await this.model.invoke(formattedPrompt);
    return response.content.trim();
  }

  parseAIResponse(response) {
    try {
      // Split response into lines and remove empty lines
      const lines = response.split("\n").filter((line) => line.trim() !== "");

      // Initialize variables
      let action = "",
        reason = "",
        draftResponse = "";
      let inDraftResponse = false;

      // Process each line
      for (const line of lines) {
        if (line.startsWith("Action:")) {
          action = line.substring("Action:".length).trim();
        } else if (line.startsWith("Reason:")) {
          reason = line.substring("Reason:".length).trim();
        } else if (line.startsWith("Draft Response:")) {
          inDraftResponse = true;
          draftResponse = line.substring("Draft Response:".length).trim();
        } else if (inDraftResponse) {
          // Append to draft response if we're in the draft response section
          draftResponse += "\n" + line;
        }
      }

      // Validate the parsed response
      if (!action || !reason || (action === "RESPOND" && !draftResponse)) {
        console.error("Parsing error - Raw response:", response);
        console.error("Parsed values:", { action, reason, draftResponse });
        throw new Error("Invalid AI response format");
      }

      // Clean up the draft response
      draftResponse = draftResponse.trim();

      return {
        action: action.toUpperCase(),
        reason,
        draftResponse: action === "RESPOND" ? draftResponse : null,
      };
    } catch (error) {
      console.error("Error parsing AI response:", error);
      console.error("Raw response:", response);

      // Return a default response in English
      return {
        action: "RESPOND",
        reason: "Error parsing AI response",
        draftResponse: "I received your email and will review it shortly.",
      };
    }
  }

  generateTaskId(task) {
    // Create a normalized string from core task attributes
    const normalizedDescription = task.description
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ");

    const components = [
      task.threadId || "",
      normalizedDescription,
      task.deadline || "",
      task.priority || "",
    ];

    // Create a hash of the components
    const crypto = require("crypto");
    const hash = crypto
      .createHash("sha256")
      .update(components.join("::"))
      .digest("hex");

    // Return a shorter, but still unique ID
    return `task_${hash.substring(0, 12)}`;
  }

  async analyzeTasksInEmail(email) {
    try {
      const userData = await userService.getUserData();
      const relevantContext = await contextService.getRelevantContext(email);

      const prompt = new PromptTemplate({
        template: `As an AI assistant for {firstName} {lastName}, analyze this email for actionable tasks.

Available Context:
{context}

Email Details:
Subject: {subject}
From: {from}
Content: {body}

Extract tasks following these rules:
1. Only include clear, actionable items
2. Use the available context to:
   - Determine task priority based on user's preferences
   - Identify related tasks or dependencies
   - Set appropriate deadlines based on context
3. Determine priority based on:
   - HIGH: Urgent or time-sensitive items
   - MEDIUM: Important but not urgent
   - LOW: Nice to have or can be delayed
4. Extract any dependencies or prerequisites

Return tasks in this EXACT format (no extra spaces or characters):
[{{"description":"task description","deadline":null,"priority":"HIGH/MEDIUM/LOW","dependencies":[],"context":"relevant context from available information"}}]

Important:
- Use context to make tasks more specific and actionable
- Reference relevant context in task descriptions
- Consider user's preferences and past interactions
- If no tasks found, return []
- Use double quotes for JSON properties
- No trailing commas
- No extra whitespace`,
        inputVariables: [
          "firstName",
          "lastName",
          "context",
          "subject",
          "from",
          "body",
        ],
      });

      const formattedPrompt = await prompt.format({
        firstName: userData.firstName,
        lastName: userData.lastName || "",
        context: JSON.stringify(relevantContext, null, 2),
        subject: email.subject || "",
        from: email.from || "",
        body: email.body || "",
      });

      const response = await this.model.invoke(formattedPrompt);

      try {
        // Clean the response content
        const cleanedContent = response.content
          .trim()
          .replace(/^```json\s*/g, "")
          .replace(/\s*```$/g, "")
          .trim();

        let tasks;
        try {
          tasks = JSON.parse(cleanedContent);
        } catch (jsonError) {
          const fixedJson = cleanedContent
            .replace(/\n/g, "")
            .replace(/,\s*]/g, "]")
            .replace(/,\s*}/g, "}");
          tasks = JSON.parse(fixedJson);
        }

        if (!Array.isArray(tasks)) {
          logger.warn("AI returned non-array response for tasks", {
            emailId: email.id,
            response: cleanedContent,
          });
          return [];
        }

        // Before returning the tasks, add context and generate IDs
        const tasksWithContext = tasks.map((task) => ({
          ...task,
          id: this.generateTaskId({ ...task, threadId: email.threadId }),
          threadId: email.threadId,
          emailId: email.id,
          from: email.from,
          subject: email.subject,
          context: {
            emailSubject: email.subject,
            emailFrom: email.from,
            emailBody: email.body,
            extractedAt: new Date().toISOString(),
          },
        }));

        return tasksWithContext;
      } catch (parseError) {
        logger.error("Error parsing AI task response", {
          error: parseError.message,
          emailId: email.id,
          response: response.content,
        });
        return [];
      }
    } catch (error) {
      logger.error("Error analyzing tasks in email", {
        error: error.message,
        emailId: email.id,
      });
      return [];
    }
  }

  extractRelevantContextForTask(task, allContext) {
    const relevantContext = {};

    // Extract context based on keywords in task description
    const keywords = task.description.toLowerCase().split(/\W+/);

    for (const category in allContext) {
      const categoryContext = {};
      for (const [key, value] of Object.entries(allContext[category])) {
        if (
          keywords.some(
            (keyword) =>
              key.toLowerCase().includes(keyword) ||
              value.toString().toLowerCase().includes(keyword)
          )
        ) {
          categoryContext[key] = value;
        }
      }
      if (Object.keys(categoryContext).length > 0) {
        relevantContext[category] = categoryContext;
      }
    }

    return relevantContext;
  }

  async compareTaskSimilarity(task1Description, task2Description) {
    try {
      // Quick pre-check using string similarity
      const quickSimilarity = this.quickStringComparison(
        task1Description,
        task2Description
      );

      if (quickSimilarity < 0.3) return 0;
      if (quickSimilarity > 0.9) return 1;

      // Include context in similarity comparison
      const prompt = new PromptTemplate({
        template: `Compare these tasks for similarity:

Task 1: {task1}
Task 2: {task2}

Consider:
1. Core objective similarity
2. Required actions similarity
3. Context and scope overlap
4. Dependencies and relationships

Return ONLY a number between 0 and 1, where:
1.0 = identical tasks
0.0 = completely different tasks
>0.8 = very similar tasks
>0.5 = somewhat related tasks
<0.3 = different tasks`,
        inputVariables: ["task1", "task2"],
      });

      const formattedPrompt = await prompt.format({
        task1: task1Description || "",
        task2: task2Description || "",
      });

      const response = await this.model.invoke(formattedPrompt);
      const similarityScore = parseFloat(response.content.trim());

      if (
        isNaN(similarityScore) ||
        similarityScore < 0 ||
        similarityScore > 1
      ) {
        logger.warn("Invalid similarity score from AI", {
          score: response.content,
          task1: task1Description,
          task2: task2Description,
        });
        return quickSimilarity;
      }

      return similarityScore;
    } catch (error) {
      logger.error("Error comparing task similarity", {
        error: error.message,
        task1Description,
        task2Description,
      });
      // Return quick similarity as fallback
      return this.quickStringComparison(
        task1Description || "",
        task2Description || ""
      );
    }
  }

  quickStringComparison(str1, str2) {
    // Convert strings to lowercase and remove punctuation
    const normalize = (str) => str.toLowerCase().replace(/[^\w\s]/g, "");
    const s1 = normalize(str1);
    const s2 = normalize(str2);

    // Get word sets
    const words1 = new Set(s1.split(/\s+/));
    const words2 = new Set(s2.split(/\s+/));

    // Calculate Jaccard similarity
    const intersection = new Set([...words1].filter((x) => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  async generateParentTaskDescription(taskGroup) {
    try {
      const prompt = new PromptTemplate({
        template: `Create a parent task description that encompasses these related tasks:

Tasks:
{tasks}

Guidelines:
1. Create a clear, concise parent task description
2. Capture the common objective
3. Keep it actionable
4. Include scope of subtasks
5. Maintain context

Return ONLY the parent task description in a single line.`,
        inputVariables: ["tasks"],
      });

      const tasksText = taskGroup
        .map((task, index) => `${index + 1}. ${task.description}`)
        .join("\n");

      const formattedPrompt = await prompt.format({
        tasks: tasksText,
      });

      const response = await this.model.invoke(formattedPrompt);
      return response.content.trim();
    } catch (error) {
      logger.error("Error generating parent task description", {
        error: error.message,
        taskCount: taskGroup?.length,
      });
      return `Combined task group (${taskGroup.length} tasks)`; // Fallback description
    }
  }

  async quickAnalyzeEmail(email) {
    try {
      const prompt = new PromptTemplate({
        template: `Quickly analyze if this email should be automatically archived without task extraction.

Subject: {subject}
From: {from}
Content: {body}

Auto-archive if ANY of these are true:
1. Automated notification or alert
2. Newsletter or marketing email
3. System-generated message
4. Service notification
5. Delivery status/tracking update
6. Calendar invitation/update
7. Subscription confirmation
8. Automated receipt/invoice
9. Social media notification
10. Promotional offer
11. "no-reply" sender address
12. Automated workflow email

Return EXACTLY in this format:
ARCHIVE: true/false
REASON: [Brief reason if should be archived]`,
        inputVariables: ["subject", "from", "body"],
      });

      const formattedPrompt = await prompt.format({
        subject: email.subject || "",
        from: email.from || "",
        body: email.body || "",
      });

      const response = await this.model.invoke(formattedPrompt);
      const lines = response.content.trim().split("\n");

      try {
        const shouldArchive =
          lines[0].split(":")[1].trim().toLowerCase() === "true";
        const reason = lines[1].split(":")[1].trim();

        logger.info(`Quick analysis result for email ${email.id}:`, {
          shouldArchive,
          reason,
        });

        return {
          shouldAutoArchive: shouldArchive,
          reason: reason,
        };
      } catch (parseError) {
        logger.error("Error parsing quick analysis response", {
          error: parseError.message,
          response: response.content,
          emailId: email.id,
        });
        return {
          shouldAutoArchive: false,
          reason: "Error parsing analysis response",
        };
      }
    } catch (error) {
      logger.error("Error in quick email analysis", {
        error: error.message,
        emailId: email.id,
      });
      return {
        shouldAutoArchive: false,
        reason: "Error performing analysis",
      };
    }
  }

  async compareTaskSets({ existingTasks, newTasks, threadContext }) {
    try {
      const prompt = new PromptTemplate({
        template: `Analyze these sets of tasks from the same email thread:

Email Thread Context:
Subject: {threadSubject}
From: {threadFrom}
Content: {threadContent}

Existing Tasks:
{existingTasksList}

New Tasks:
{newTasksList}

For each new task, determine if it:
1. Is completely new and should be created
2. Updates/refines an existing task
3. Is a duplicate and should be skipped

Consider:
- Tasks might be reworded versions of the same requirement
- Some tasks might be more detailed versions of existing ones
- Tasks might be split or combined differently
- Context from the email thread

Return your analysis in this EXACT format (no extra spaces or line breaks):
{{"results": [
  {{"task": {{"description": "task text", "priority": "priority", "deadline": "deadline"}}, "action": "CREATE/UPDATE/SKIP", "existingTaskId": "id if updating", "updatedTask": {{"description": "updated text", "priority": "priority", "deadline": "deadline"}}, "reason": "explanation"}}
]}}`,
        inputVariables: [
          "threadSubject",
          "threadFrom",
          "threadContent",
          "existingTasksList",
          "newTasksList",
        ],
      });

      const formattedPrompt = await prompt.format({
        threadSubject: threadContext.subject || "",
        threadFrom: threadContext.from || "",
        threadContent: threadContext.body || "",
        existingTasksList:
          existingTasks
            .map(
              (task, i) =>
                `${i + 1}. [ID: ${task.id}] ${task.description} (Priority: ${
                  task.priority
                }${task.deadline ? `, Due: ${task.deadline}` : ""})`
            )
            .join("\n") || "No existing tasks",
        newTasksList: newTasks
          .map(
            (task, i) =>
              `${i + 1}. ${task.description} (Priority: ${task.priority}${
                task.deadline ? `, Due: ${task.deadline}` : ""
              })`
          )
          .join("\n"),
      });

      const response = await this.model.invoke(formattedPrompt);

      try {
        const result = JSON.parse(response.content.trim());

        // Preserve context and metadata when suggesting updates
        result.results = result.results.map((result) => {
          if (result.action === "UPDATE" && result.existingTaskId) {
            const existingTask = existingTasks.find(
              (t) => t.id === result.existingTaskId
            );
            if (existingTask) {
              result.updatedTask = {
                ...result.updatedTask,
                emailId: existingTask.email_id,
                threadId: existingTask.thread_id,
                from: existingTask.from_address,
                subject: existingTask.subject,
                context: existingTask.context,
              };
            }
          }
          return result;
        });

        logger.info("Task comparison results", {
          totalResults: result.results.length,
          actions: result.results.map((r) => r.action),
        });
        return result.results;
      } catch (parseError) {
        logger.error("Error parsing AI comparison response", {
          error: parseError.message,
          response: response.content,
        });
        // If parsing fails, treat all tasks as new
        return newTasks.map((task) => ({
          task,
          action: "CREATE",
          existingTaskId: null,
          updatedTask: null,
          reason: "Error parsing AI response, creating as new task",
        }));
      }
    } catch (error) {
      logger.error("Error comparing task sets", {
        error: error.message,
        existingTaskCount: existingTasks.length,
        newTaskCount: newTasks.length,
      });
      // On error, treat all tasks as new
      return newTasks.map((task) => ({
        task,
        action: "CREATE",
        existingTaskId: null,
        updatedTask: null,
        reason: "Error during comparison, creating as new task",
      }));
    }
  }
}

module.exports = new AIService();
