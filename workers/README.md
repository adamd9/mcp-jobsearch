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

5. Configure environment variables in `wrangler.toml`:
   - `OPENAI_API_KEY`: Your OpenAI API key
   - `OPENAI_MODEL`: OpenAI model to use (default: gpt-4o)
   - `ACCESS_TOKEN`: Secure token for API authentication

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
