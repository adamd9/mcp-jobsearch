# MCP Job Search

This project implements a LinkedIn job scraper with persistent job indexing, deep scanning, and filtering capabilities using Cloudflare Workers. It scrapes LinkedIn job listings, performs detailed analysis of each job against a candidate profile using OpenAI, stores matches in Cloudflare KV, and exposes MCP-compatible HTTP endpoints.

## Architecture

This implementation uses:
- **Cloudflare Workers** for serverless execution
- **Cloudflare's Playwright fork** for web scraping
- **Cloudflare KV** for persistent data storage
- **OpenAI API** for job analysis and matching
- **MCP (Model Context Protocol)** for tool integration

## Current Status

The worker is fully functional and can be run locally. It includes a complete MCP server with authentication, CORS handling, a health check endpoint, and SSE endpoints for real-time updates.

Some tools are currently implemented as stubs returning mock data, allowing for testing the end-to-end flow. The plan management tools (`get_plan`, `create_plan`, `update_plan`) and email digest functionality (`send_digest`) are fully implemented.

## Setup

### Prerequisites

- Node.js (v18 or later)
- npm or yarn
- Cloudflare account (for deployment)

### Environment Variables

Create a `.env` file in the project root with the following variables:

```env
# OpenAI Configuration
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-4o

# LinkedIn Credentials (for scraping)
LINKEDIN_EMAIL=your-linkedin-email@example.com
LINKEDIN_PASSWORD=your-linkedin-password

# Email Configuration (for digests)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-smtp-username
SMTP_PASS=your-smtp-password
DIGEST_FROM=jobs@example.com
DIGEST_TO=you@example.com

# Application Settings
TIMEZONE=Australia/Sydney
ACCESS_TOKEN=your-secure-random-token
DEEP_SCAN_CONCURRENCY=2
```

The `ACCESS_TOKEN` is used for API authentication and should be a secure random string.

### Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up your environment variables in `.env`

3. Create a job search plan (see Plan Management section below)

### Running the Worker

Start the development server:

```bash
npm run dev
```

The worker will be available at `http://localhost:8787`.

## Core Features

### Plan-Driven Search
Define your profile, search terms, and scan criteria in a job search plan. The system uses this plan to:
- Target relevant job searches on LinkedIn
- Analyze job matches against your profile using OpenAI
- Score jobs based on fit and requirements

### Persistent Job Index
All scraped jobs are stored persistently in Cloudflare KV with:
- Job details and metadata
- Match scores and analysis
- Scan history and timestamps
- Deduplication to avoid processing the same job twice

### Deep Scanning
Visits each job posting to extract comprehensive details:
- Full job description and requirements
- Company information and culture
- Salary and benefits information
- AI-powered analysis against your profile

### Email Digests
Automated email summaries of your best job matches:
- Configurable match score thresholds
- Rich HTML formatting with job details
- Direct links to job postings
- Scheduled delivery options

## API Reference

### MCP Tools

The following tools are available via the MCP server:

#### Plan Management
- **`get_plan`**: Get the current job search plan
- **`create_plan`**: Create a new job search plan from a description
- **`update_plan`**: Update the existing job search plan

#### Job Scanning & Analysis
- **`scan`**: Scan LinkedIn job pages using Playwright - if URL provided, scans that page; otherwise uses plan URLs
- **`rescan`**: Rescan existing jobs using URLs from the last scan or current plan
- **`deep_scan_job`**: Manually deep scan a specific LinkedIn job URL for testing and debugging
- **`failed_jobs`**: Get a report of jobs that failed during deep scanning with error analysis

#### Job Index Management
- **`get_job_index`**: Get the current raw job index data for inspection (with filtering options)
- **`reset_job_index`**: Reset the job index to start fresh - removes all stored jobs

#### System Operations
- **`status`**: Check the status of background jobs (scan progress, errors, etc.)
- **`send_digest`**: Send digest email with job matches to specified email address

### HTTP Endpoints

The worker exposes HTTP endpoints for direct API access:

#### Core Endpoints
- `GET /health` - Health check endpoint (no authentication required)
- `POST /mcp` - MCP server endpoint (handles all tool calls with authentication)

**Note**: All MCP tools are accessed via the `/mcp` endpoint using the MCP protocol. The worker uses token-based authentication for the MCP endpoint.

## Plan Management

The job search plan is the core configuration that drives the entire system. It defines:

### Plan Structure

```json
{
  "profile": {
    "name": "Your Name",
    "experience": "Senior Software Engineer with 8+ years...",
    "skills": ["JavaScript", "React", "Node.js", "AWS"],
    "preferences": {
      "remote": true,
      "location": "Sydney, Australia",
      "salary_min": 120000
    }
  },
  "searches": [
    {
      "keywords": "Senior Software Engineer React",
      "location": "Sydney",
      "filters": {
        "experience_level": "mid_senior",
        "job_type": "full_time"
      }
    }
  ],
  "scan_prompt": "Analyze this job posting for a senior software engineer..."
}
```

### Creating a Plan

You can create a plan in several ways:

1. **Via MCP Tool**: Use the `create_plan` tool with a natural language description
2. **Via HTTP API**: POST to `/plan` with either JSON or description
3. **Direct File**: Create a `plan.json` file in the project root

### Plan Examples

**Natural Language Description**:
```
I'm a senior full-stack developer with 8 years experience in React, Node.js, and AWS. 
I'm looking for remote senior engineer roles in fintech or healthcare, 
preferably $120k+ with equity options.
```

**Structured JSON**:
```json
{
  "profile": {
    "name": "Senior Developer",
    "experience": "8+ years full-stack development",
    "skills": ["React", "Node.js", "AWS", "TypeScript"]
  },
  "searches": [
    {
      "keywords": "Senior Full Stack Engineer",
      "location": "Remote"
    }
  ]
}
```

## Deployment

### Local Development

For local development, the worker runs using Wrangler:

```bash
npm run dev
```

This starts a local development server at `http://localhost:8787`.

### Production Deployment

To deploy to Cloudflare Workers:

1. **Configure Wrangler**: Ensure you have a `wrangler.toml` file configured
2. **Set Environment Variables**: Configure secrets in Cloudflare Workers dashboard
3. **Deploy**: Run the deployment command

```bash
npm run deploy
```

### Environment Variables in Production

Set these as secrets in your Cloudflare Workers environment:

```bash
wrangler secret put OPENAI_API_KEY
wrangler secret put LINKEDIN_EMAIL
wrangler secret put LINKEDIN_PASSWORD
wrangler secret put SMTP_HOST
wrangler secret put SMTP_USER
wrangler secret put SMTP_PASS
wrangler secret put ACCESS_TOKEN
```

## Implementation Status

### ✅ Fully Implemented Features

#### Core Infrastructure
- MCP server with complete tool integration
- Cloudflare Workers runtime environment
- Token-based authentication and CORS handling
- Background job processing with status tracking

#### Plan Management
- **Plan Creation & Updates**: AI-powered plan generation from natural language descriptions
- **Plan Storage**: Persistent storage in Cloudflare KV
- **Search URL Generation**: Automatic LinkedIn search URL creation
- **Plan Feedback**: AI analysis and recommendations for plan improvement

#### Job Scanning & Analysis
- **LinkedIn Scraping**: Full Playwright-based job page scraping
- **Deep Scanning**: Individual job analysis with OpenAI integration
- **Background Processing**: Non-blocking scan operations with status tracking
- **Error Handling**: Comprehensive error reporting and failed job analysis
- **Fallback Matching**: Keyword-based matching when AI is unavailable

#### Job Index Management
- **Persistent Storage**: Cloudflare KV-based job index with deduplication
- **Job Tracking**: Scan status, match scores, and metadata storage
- **Index Inspection**: Detailed job index viewing with filtering options
- **Index Reset**: Complete job index cleanup functionality

#### Email Digest System
- **SMTP Integration**: Nodemailer-based email sending
- **HTML Email Generation**: Rich formatting with job details and links
- **Auto-digest**: Automatic email sending after scan completion
- **Job Tracking**: Mark jobs as sent to avoid duplicates

#### Debugging & Monitoring
- **Manual Deep Scan**: Test individual job URLs for debugging
- **Failed Jobs Report**: Detailed analysis of scan failures with error categorization
- **Status Monitoring**: Real-time background job status tracking

### Authentication

API endpoints are protected with token-based authentication. Include your `ACCESS_TOKEN` in requests:

```bash
curl -H "Authorization: Bearer your-access-token" http://localhost:8787/status
```

## Troubleshooting

### Common Issues

1. **LinkedIn Authentication**: Ensure your LinkedIn credentials are correct and the account isn't locked
2. **OpenAI API**: Verify your API key has sufficient credits and proper permissions
3. **Email Delivery**: Check SMTP settings and ensure the sender email is authorized
4. **Environment Variables**: Verify all required variables are set in your `.env` file

### Known Warnings

When testing email functionality, you may see network-related warnings in the Cloudflare Workers environment:
- "Failed to resolve IPv4 addresses with current network"
- "Possible EventEmitter memory leak detected"

These are environmental warnings and don't prevent functionality from working correctly.

### Development Tips

- Use the `/health` endpoint to verify the worker is running
- Check the browser console for detailed error messages
- Use the mock data endpoints for testing without external dependencies
- Test plan creation with natural language descriptions before implementing complex JSON structures

## Architecture Notes

### Data Storage
The worker uses Cloudflare KV for persistent storage of job indexes, search plans, and scan history.

### CORS Handling
Comprehensive CORS support is included for cross-origin requests from web applications.

### SSE Support
Server-Sent Events are supported for real-time updates during long-running operations like job scanning.

## Limitations

The Worker implementation has some limitations compared to the Node.js version:

1. **No Raw File Storage**: The Worker cannot store raw HTML or job extraction files due to lack of filesystem access.
2. **No Screenshots**: Screenshot capture is not supported in the Worker environment.
3. **Limited Storage**: Job data is stored in Cloudflare KV, which has size limitations.


