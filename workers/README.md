# MCP Job Search - Cloudflare Worker Implementation

This directory contains the Cloudflare Worker implementation for the MCP Job Search project. The worker exposes an MCP server with a set of tools for managing a job search.

## Current Status

The worker is fully functional and can be run locally. It includes a complete MCP server with authentication, CORS handling, a health check endpoint, and SSE endpoints for real-time updates.

All tools are currently implemented as stubs, returning mock data. This allows for testing the end-to-end flow of the application without requiring access to external services or APIs.

### Running the Worker

To run the worker locally, you will first need to install the dependencies:

```bash
npm install
```

Then, you can start the worker using the following command:

```bash
npm run dev
```

The worker will be available at `http://localhost:8787`.

### Implemented Tools

The following tools are available on the MCP server:

*   **`get_plan`**: Get the current job search plan.
*   **`create_plan`**: Create a new job search plan from a description.
*   **`update_plan`**: Update the existing job search plan.
*   **`scan`**: Scan for jobs based on the plan.
*   **`rescan`**: Rescan existing jobs in the index.
*   **`jobs`**: Get jobs from the index with optional filtering.
*   **`status`**: Get the current status of the job search service.
*   **`reset_job_index`**: Reset the job index.
*   **`send_digest`**: Send a digest email with job matches.

## Next Steps: Tool Implementation

The next phase of the project is to implement the tools with real functionality. You MUST replicate / reimplement the logic from the src folder, as it is known to be working (but adapt for clouldflare for eg, in terms of storage). Here is a suggested order for implementation:

1.  **`get_plan` / `create_plan` / `update_plan`**: These tools will manage the job search plan. We will need to decide where to store the plan data (e.g., in a database, a file, or a key-value store). The original implementation in `src/plan.js` uses a local `plan.json` file. We can adapt the `getPlan`, `createPlanFromDescription`, and `updatePlanFromDescription` functions for the worker, using Cloudflare KV for storage.
STOP IMPLEMENTING ONCE THIS IS DONE SO THE USER CAN TEST
2.  **`scan`**: This tool will be responsible for searching for jobs on external sites (e.g., LinkedIn). This will likely involve web scraping or using an API. The original implementation in `src/scrape.js` and `src/deep-scan.js` uses Playwright for scraping and OpenAI for analysis. We can adapt the `scrapeMultipleSearches` and `deepScanJobs` functions for the worker.
STOP IMPLEMENTING ONCE THIS IS DONE SO THE USER CAN TEST
3.  **`jobs`**: This tool will retrieve jobs from our own data store. The original implementation in `src/storage.js` uses a `job-index.json` file as a database. The `filterJobs` function in `src/filter.js` provides an AI-powered filtering layer. We can adapt these for the worker, using Cloudflare KV for storage.
4.  **`rescan`**: This tool will re-evaluate the jobs in our data store against the current plan. The original implementation uses the `deepScanJobs` function from `src/deep-scan.js` with the `forceRescan` option. We can follow a similar approach.
STOP IMPLEMENTING ONCE THIS IS DONE SO THE USER CAN TEST
5.  **`status`**: This tool will provide real-time status updates on the job search process.
STOP IMPLEMENTING ONCE THIS IS DONE SO THE USER CAN TEST
6.  **`reset_job_index`**: This tool will clear out the job data store.
STOP IMPLEMENTING ONCE THIS IS DONE SO THE USER CAN TEST
7.  **`send_digest`**: This tool will send an email digest of job matches.
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
