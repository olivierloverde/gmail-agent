# Gmail AI Agent 📧 🤖

An intelligent email management system that automates email processing using AI. The system analyzes emails, suggests actions, and allows control through Telegram.

# Demo

https://github.com/user-attachments/assets/a0b01e5f-2835-49d7-971d-f4c18abda5ee

https://github.com/user-attachments/assets/2466c90a-c5fe-40fe-80c2-e5477a41ac5b

https://github.com/user-attachments/assets/a5fb1641-c8da-4a26-93c8-9d14a74cbb6f

## Features 🌟

### Top features

- **AI-Powered Analysis**: Uses GPT models to understand email context and intent
- **Smart Response Generation**: Creates contextually appropriate responses
- **Smart Email Summarization**: Generates action-driven email summaries
- **Bulk Email Management**: Groups and handles similar emails efficiently
- **Vector Similarity**: Uses embeddings to find truly similar emails
- **Telegram Control**: Full email management through Telegram interface
- **Multi-language Support**: Handles emails in any language
- **Smart Threading**: Understands email conversation context
- **Customizable Actions**: Archive, respond, or request more information
- **Task Management**: Automatically extracts and manages tasks from emails
- **Persistent Storage**: SQLite database for reliable task and email tracking

### Email Summaries

The bot provides comprehensive email summaries to help you stay on top of your inbox:

#### Scheduled Summaries

- 🌅 **Morning Overview (9 AM)**
  - Covers emails from 5 PM previous day to 9 AM
  - Perfect for catching up on overnight communications
- 🌞 **Midday Catch-up (2 PM)**
  - Covers emails from 9 AM to 2 PM
  - Stay updated on morning developments
- 🌙 **Evening Wrap-up (7 PM)**
  - Covers emails from 2 PM to 7 PM
  - Review afternoon communications and plan for tomorrow

#### On-Demand Summary

- 📋 **Quick Summary**
  - Covers the last 3 hours of emails
  - Useful for immediate status checks

Each summary includes:

- Brief overview of important communications
- Top 5 priority emails ranked by urgency
- Key insights and action items
- Extracted tasks and their status

### Task Management

The system automatically:

- Extracts tasks from incoming emails
- Groups similar tasks to avoid duplication
- Assigns priorities (HIGH/MEDIUM/LOW) based on context
- Creates parent tasks for related items
- Tracks task status and progress
- Provides task summaries via Telegram
- Sends completion notifications to original email threads
- Maintains task dependencies and relationships
- Stores task history and updates in SQLite database

Task Features:

- Automatic priority assignment based on urgency and context
- Smart task grouping using AI similarity detection
- Parent-child task relationships for complex items
- Task completion notifications sent to original senders
- Task status tracking (PENDING/COMPLETED)
- Task context preservation with email thread information

## Commands

- `/summary`: Request an email summary
  - Choose from morning, midday, evening, or quick summary types
  - Each type covers a specific time range
  - Summaries are focused on actionable items only
- `/tasks`: View and manage tasks
  - List all tasks
  - Filter by status/priority
  - Update task status
  - View task details
  - Mark tasks as complete with `/task_done <task_id>`
- `/help`: Display available commands and information
- `/start_processing`: Begin email processing
- `/stop_processing`: Stop email processing
- `/processing_status`: Check current processing status

### Task Management Interface

The bot provides interactive buttons for task management:

- 🔄 Refresh List - Update task list
- ⏰ Due Tasks - View upcoming deadlines
- 🔴 High Priority - Filter high priority tasks
- 🟡 Medium Priority - Filter medium priority tasks
- ◀️ Back to Menu - Return to main menu

## Prerequisites 📋

- Node.js v16+
- Gmail Account with API access
- Telegram Bot Token
- OpenAI API Key
- SQLite3

## Quick Start 🚀

1. Clone and install:

```bash
git clone https://github.com/olivierloverde/gmail-agent.git
cd gmail-agent
npm install
```

2. Run the automated setup wizard:

```bash
npm start
```

The setup wizard will:

- Guide you through API setup process
- Help create necessary credentials
- Configure environment variables
- Set up Gmail authentication
- Configure Telegram bot
- Test all connections

## Detailed Setup Guide 📖

### Automated Setup Wizard

On first run, the application will launch an interactive setup wizard that will:

1. Check for missing configurations
2. Guide you through obtaining necessary API keys
3. Help you set up:
   - Gmail API credentials
   - Telegram bot token
   - OpenAI API key
4. Create and configure the `.env` file automatically
5. Validate all credentials
6. Initialize required directories and files

The wizard will provide step-by-step instructions for:

### Gmail API Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create new project or select existing
3. Enable Gmail API
4. Create OAuth 2.0 credentials
5. Download credentials file

### Telegram Bot Setup

1. Message [@BotFather](https://t.me/botfather)
2. Create new bot
3. Get bot token
4. Get user ID from [@userinfobot](https://t.me/userinfobot)

### OpenAI API Setup

1. Visit [OpenAI Platform](https://platform.openai.com)
2. Create API key

The wizard will automatically save all configurations to the `.env` file.

## Usage Guide 💡

### Overview

1. Start a chat with your Telegram bot
2. Use the `/help` command to see available options
3. Use the `/summary` command to request an email summary
   - Select the desired time range based on your needs
   - Morning: overnight emails since 5 PM yesterday
   - Midday: morning emails since 9 AM
   - Evening: afternoon emails since 2 PM
   - Quick: last 3 hours of emails
4. Interact with the bot to manage your emails efficiently

The bot will automatically process incoming emails and send you notifications for important messages. You can then choose to respond, archive, or take other actions directly through the Telegram interface.

### Telegram Commands

- `1` - Confirm suggested action
- `2` - Reject suggestion
- `3` - Edit response/Force reply
- `4` - Force archive (for RESPOND actions)

### Email Processing

The system will:

1. Fetch unread emails
2. Analyze content using AI
3. Send Telegram notification
4. Wait for your action
5. Execute chosen action

### Bulk Operations

When archiving, the system:

1. Checks for similar emails
2. Shows bulk archive options
3. Allows individual selection

## Configuration ⚙️

After initial setup, you can manually adjust settings in `.env`:

```env
GMAIL_CREDENTIALS=./credentials.json
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_USER_ID=your_user_id
OPENAI_API_KEY=your_openai_key
```

### Advanced Settings

Adjust in `src/services/emailService.js`:

```javascript
this.similarityThreshold = 0.85; // Similarity detection threshold
maxResults: 500, // Number of emails per batch
```

## Troubleshooting 🔍

### Authentication Issues

If authentication fails:

```bash
rm token.json
npm start
```

The setup wizard will automatically run if configuration is missing.

### Rate Limits

If hitting API limits:

1. Increase delays between requests
2. Reduce batch sizes
3. Adjust similarity thresholds

### Message Format Errors

If Telegram messages fail:

1. Check special characters
2. Verify markdown syntax
3. Reduce message length

## Support and Contribution 🤝

- Report issues on GitHub
- Submit pull requests

## License 📄

MIT License - See LICENSE file

## Security Notes 🔒

- Credentials are automatically secured
- Environment variables are properly handled
- API keys are stored safely
- Access is limited to authorized user
