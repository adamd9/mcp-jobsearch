# MCP Job Search - Cloudflare Worker Implementation

This directory contains the Cloudflare Worker implementation of the MCP Job Search project. This version uses Cloudflare Workers and Cloudflare's Playwright fork for LinkedIn job scraping.

## Features

- **MCP Server**: Implements a Model Context Protocol server for job searching
- **LinkedIn Scraping**: Uses Cloudflare's Playwright fork for scraping job listings
- **Job Matching**: Analyzes job listings against candidate profiles using OpenAI
- **Persistent Storage**: Stores job data in Cloudflare KV

## Setup

### Prerequisites

1. [Node.js](https://nodejs.org/) (v16 or later)
2. [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
3. Cloudflare account

### Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Login to Cloudflare:
   ```bash
   npx wrangler login
   ```

3. Create a KV namespace for job storage:
   ```bash
   npx wrangler kv:namespace create JOB_STORAGE
   ```

4. Update `wrangler.toml` with your KV namespace ID from the previous step.

5. Configure environment variables:

   **For local development**:
   Create a `.dev.vars` file in the workers directory with your environment variables:
   ```
   # API Authentication token - randomly generated
   ACCESS_TOKEN=your_secure_token_here
   OPENAI_API_KEY=your_openai_api_key_here
   OPENAI_MODEL=gpt-4o
   LINKEDIN_EMAIL=your_linkedin_email@example.com
   LINKEDIN_PASSWORD=your_linkedin_password
   SMTP_HOST=your_smtp_host.com
   SMTP_PORT=587
   SMTP_USER=your_smtp_user@example.com
   SMTP_PASS=your_smtp_password
   DIGEST_TO=recipient@example.com
   TIMEZONE=Australia/Sydney
   ```
   
   **For production deployment**:
   Add secrets using the Wrangler CLI:
   ```bash
   # For sensitive information (recommended for passwords, tokens, API keys)
   npx wrangler secret put ACCESS_TOKEN
   npx wrangler secret put LINKEDIN_PASSWORD
   npx wrangler secret put OPENAI_API_KEY
   npx wrangler secret put SMTP_PASS
   ```
   
   Add non-sensitive variables in `wrangler.toml`:
   ```toml
   [vars]
   OPENAI_MODEL = "gpt-4o"
   LINKEDIN_EMAIL = "your_linkedin_email@example.com"
   SMTP_HOST = "your_smtp_host.com"
   SMTP_PORT = "587"
   SMTP_USER = "your_smtp_user@example.com"
   DIGEST_TO = "recipient@example.com"
   TIMEZONE = "Australia/Sydney"
   ```
   
   **Alternatively**, you can add all variables (including secrets) through the Cloudflare dashboard:
   1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
   2. Navigate to Workers & Pages > Your Worker > Settings > Variables
   3. Add your environment variables and mark sensitive ones as "Encrypted"

### Local Development

To run the Worker locally:

```bash
npm run dev
```

This will start a local development server at http://localhost:8787.

### Deployment

To deploy to Cloudflare Workers:

```bash
npm run deploy
```

## API Endpoints

### MCP Server

- `POST /mcp`: Main MCP server endpoint

### API Endpoints

- `GET /api/plan`: Get the current job search plan

## Authentication

All endpoints require authentication using the `ACCESS_TOKEN` from your configuration. Include the token in the `Authorization` header with each request:

```
Authorization: Bearer your-access-token-here
```

## Limitations

The Worker implementation has some limitations compared to the Node.js version:

1. **No Raw File Storage**: The Worker cannot store raw HTML or job extraction files due to lack of filesystem access.
2. **No Screenshots**: Screenshot capture is not supported in the Worker environment.
3. **Limited Storage**: Job data is stored in Cloudflare KV, which has size limitations.

## Deploy to Cloudflare Button

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/YOUR_USERNAME/mcp-jobsearch)

To use the Deploy to Cloudflare button:
1. Fork this repository
2. Update the URL in the button above with your GitHub username
3. Click the button to deploy to your Cloudflare account
4. Configure the required environment variables during deployment
