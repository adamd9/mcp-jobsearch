# MCP Job Search Node

This project implements a LinkedIn job scraper with persistent job indexing, deep scanning, and filtering capabilities. It scrapes LinkedIn job listings, performs detailed analysis of each job against a candidate profile using OpenAI, stores matches in a persistent job index, and exposes MCP-compatible HTTP endpoints.

## Setup

1. Copy `.env.example` to `.env` and fill in your credentials:
   ```
   LINKEDIN_EMAIL=your-linkedin-email@example.com
   LINKEDIN_PASSWORD=your-linkedin-password
   OPENAI_API_KEY=your-openai-api-key
   OPENAI_MODEL=gpt-4o
   DEEP_SCAN_CONCURRENCY=2
   SMTP_HOST=smtp.example.com
   SMTP_PORT=587
   SMTP_USER=your-smtp-username
   SMTP_PASS=your-smtp-password
   DIGEST_FROM=jobs@example.com
   DIGEST_TO=you@example.com
   TIMEZONE=Australia/Sydney
   ACCESS_TOKEN=your-secure-random-token
   ```
   
   The `ACCESS_TOKEN` is used for API authentication and should be a secure random string.

2. Run `./setup.sh` to install npm packages and Playwright's browser dependencies.
3. Create a `plan.json` file (or use the `/plan` endpoint) describing your profile, search terms and deep scan criteria.
4. Start the server with `npm start`.

## Core Features
- **Plan Driven Search**: Define your profile, search terms and scan prompt in `plan.json` or via the `/plan` API.

### Persistent Job Index
- **Storage**: All scraped jobs are stored in a persistent JSON file (`data/job-index.json`).
- **Deduplication**: Jobs are uniquely identified by LinkedIn job ID to prevent duplicate scanning.
- **Profile Change Detection**: System detects when your profile changes and triggers rescans.
- **Metadata**: Each job entry includes scan status, match score, and detailed information.

#### Job Index Structure
Each job in `data/job-index.json` keeps the basic listing data along with the
results of the most recent deep scan:

```json
{
  "id": "123456",
  "title": "Full Stack Engineer",
  "company": "ExampleCo",
  "link": "https://linkedin.com/jobs/view/123456",
  "posted": "2025-06-09",
  "scanned": true,
  "scanDate": "2025-07-05T12:00:00+10:00",
  "matchScore": 0.85,
  "matchReason": "Good skills overlap with your profile",
  "description": "Full job description...",
  "requirements": ["Skill 1", "Skill 2"],
  "location": "Sydney, Australia",
  "salary": "$100k - $120k"
}
```

After each deep scan the `matchScore` and `matchReason` are updated so you can
see why a job was scored the way it was. When a job is rescanned (for example
after updating your profile) you may choose to store multiple scores in an array
so previous results are preserved:

```json
{
  "scanHistory": [
    { "date": "2025-07-05T12:00:00+10:00", "score": 0.85,
      "summary": "Good skills overlap with your profile" },
    { "date": "2025-07-10T12:00:00+10:00", "score": 0.88,
      "summary": "Profile updated with React experience" }
  ]
}
```

### Deep Scanning
- **Detailed Extraction**: Visits each job posting to extract comprehensive details (description, requirements, salary).
- **AI Analysis**: Uses OpenAI to analyze job details against your profile.
- **Match Scoring**: Generates a match score (0-1) and explanation for each job.
- **Concurrency Control**: Configurable number of concurrent scans to balance speed and resource usage.

### API Endpoints

#### Authentication
All API endpoints require authentication using the `ACCESS_TOKEN` from your `.env` file. Include the token in the `Authorization` header with each request:

```
Authorization: Bearer your-access-token-here
```

Requests without a valid authentication token will receive a 401 Unauthorized response.

##### Authentication Examples

###### Using cURL
```bash
# Example GET request with authentication
curl -X GET http://localhost:8000/jobs \
  -H "Authorization: Bearer your-access-token-here"

# Example POST request with authentication and JSON body
curl -X POST http://localhost:8000/send_digest \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-access-token-here" \
  -d '{"email": "you@example.com"}'
```

###### Using JavaScript/Fetch
```javascript
// Example GET request with authentication
fetch('http://localhost:8000/jobs', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer your-access-token-here'
  }
})
.then(response => response.json())
.then(data => console.log(data));

// Example POST request with authentication
fetch('http://localhost:8000/send_digest', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer your-access-token-here'
  },
  body: JSON.stringify({ email: 'you@example.com' })
})
.then(response => response.json())
.then(data => console.log(data));
```

###### Using the MCP Client
When using the MCP client library to connect to the MCP server, you'll need to pass the token in the headers:

```javascript
import { McpClient } from '@modelcontextprotocol/sdk/client/mcp.js';

const client = new McpClient({
  url: 'http://localhost:8000/mcp',
  headers: {
    'Authorization': 'Bearer your-access-token-here'
  }
});

// Now you can use the client to call MCP tools
const result = await client.callTool('get_plan', {});
```

###### Updating Test Scripts
If you're using the provided npm test scripts, you'll need to update them to include the authorization header. For example:

```bash
# Add this to your package.json scripts or create a custom script
"test:jobs:auth": "curl -H 'Authorization: Bearer $ACCESS_TOKEN' http://localhost:8000/jobs | jq"
```

Or set the token as an environment variable before running scripts:

```bash
# Set the token as an environment variable
export ACCESS_TOKEN=your-access-token-here

# Then run your scripts which should be updated to use this environment variable
npm run test:jobs:all
```

#### Plan Management
- `GET /plan` – Retrieve the current plan.
- `POST /plan` – Body `{ "description": "..." }` to generate a plan from text using OpenAI.
- `PUT /plan` – Update fields of the existing plan (`profile`, `searchTerms`, `scanPrompt`).

#### Job Scanning and Retrieval
- `GET /scan` – Triggers a LinkedIn scrape and deep scan without sending an email digest.
  - **What it does**: Scrapes LinkedIn job listings, adds them to the job index, and performs deep scanning on new jobs.
  - **When to use**: When you want to update your job index without sending an email.

- `POST /rescan` – Forces a deep rescan of all jobs in the index.
  - **What it does**: Re-evaluates all jobs against your current profile, even previously scanned ones.
  - **When to use**: After updating your profile or when you want fresh match scores.

- `GET /jobs` – Returns all jobs from the index with powerful filtering options:
  - **Parameters**:
    - `minScore=0.7` – Only return jobs with match score >= specified value (0-1)
    - `scanned=true|false` – Filter by scan status (completed or pending scan)
    - `limit=10` – Limit the number of results returned
  - **When to use**: For browsing or filtering the job index in custom ways.

- `GET /job/:id` – Returns detailed information for a specific job by ID.
  - **What it does**: Retrieves complete job details including description, requirements, match score, etc.
  - **When to use**: When you need to examine a specific job in detail.

#### Email Digests
- `GET /latest_matches` – Returns job matches with score >= 0.7 from the job index.
  - **What it does**: Retrieves jobs that match your profile well (70% match or better).
  - **When to use**: To quickly check your best matches without scanning.

- `POST /send_digest` – Body `{ "email": "you@example.com" }`. Scrapes, deep scans, and emails the matches.
  - **What it does**: Complete workflow - scrapes LinkedIn, updates index, deep scans jobs, and sends email digest.
  - **When to use**: When you want to receive an email with your latest job matches.

## Workflow Examples

### Initial Setup Workflow
1. Configure your `.env` file with LinkedIn credentials
2. Create your `plan.json` (or POST to `/plan`) with profile and search terms
3. Start the server: `npm start`
4. Trigger initial scan: `npm run test:scan`
5. Wait for deep scanning to complete
6. View matched jobs: `npm run test:jobs:matched`

### Daily Usage Workflow
1. Server automatically runs daily scan at 07:00 AEST and emails digest
2. Alternatively, manually trigger scan: `npm run test:scan`
3. Check latest matches: `npm run test:latest`
4. View specific job details: `ID=job_id npm run test:job`

### Profile Update Workflow
1. Update your `plan.json` (or use `PUT /plan`) with new skills or search terms
2. Force rescan of all jobs: `npm run test:rescan`
3. View updated matches: `npm run test:jobs:matched`

## Testing Commands

The project includes comprehensive test commands for both real and mock data scenarios:

### Unit Tests
```bash
# Run all unit tests (using test fixtures, not live scraping)
npm run test:unit
```

### Endpoint Testing with Real Data
```bash
# Start the server first
npm start

# Trigger LinkedIn scraping and deep scanning (no email)
npm run test:scan

# Force deep rescan of all jobs in the index
npm run test:rescan

# Get all jobs from the index (formatted JSON output)
npm run test:jobs:all

# Get jobs with match score >= 0.7
npm run test:jobs:matched

# Get unscanned jobs only
npm run test:jobs:unscanned

# Get limited number of jobs (5)
npm run test:jobs:limit

# Get details for a specific job (set ID env var first)
# Example: ID=4247412997 npm run test:job
npm run test:job

# Get latest matches (score >= 0.7)
npm run test:latest

# Trigger full workflow and send digest email
# (update email in package.json first)
npm run test:digest
```

### Endpoint Testing with Mock Data
```bash
# Test scan endpoint with mock data
npm run test:scan:mock

# Test rescan endpoint with mock data
npm run test:rescan:mock

# Test digest email with mock data
npm run test:digest:mock
```

## Configuration

The application uses a configuration system that combines settings from:

1. Default values in code
2. `config.json` file in the project root
3. Environment variables (which take precedence)

### Configuration File

You can edit the `config.json` file to set persistent configuration options:

```json
{
  "mockMode": false,
  "openaiModel": "gpt-4o",
  "deepScanConcurrency": 2,
  "timezone": "Australia/Sydney",
  "jobIndexPath": "data/job-index.json"
}
```

### Key Configuration Options

- **mockMode**: When set to `true`, the system uses mock data instead of real scraping/scanning
- **openaiModel**: The OpenAI model to use for job matching
- **deepScanConcurrency**: Number of concurrent deep scans to perform
- **timezone**: Timezone for cron scheduling
- **jobIndexPath**: Path to the job index file

## How Mock Data Works

Mock data testing uses pre-defined fixtures instead of live LinkedIn scraping:

1. **Mock LinkedIn Search Results**: `test/fixtures/linkedin-search-results.json`
   - Contains sample job listings as if scraped from LinkedIn
   - Used by the `/scan` endpoint when mock mode is enabled
   - Format structure:
     ```json
     [
       {
         "title": "Software Engineer, Backend",        // Job title
         "link": "https://www.linkedin.com/jobs/...", // Full LinkedIn job URL
         "posted": "2025-07-02",                    // Posting date (YYYY-MM-DD)
         "id": "software-engineer-backend-at-...",   // Unique job identifier
         "company": null,                            // Company name (may be null)
         "scrapedDate": "2025-07-06T21:03:06.401Z"  // ISO timestamp of scraping
       },
       // Additional job listings...
     ]
     ```

2. **Mock Job Details**: `test/fixtures/linkedin-job-details.json`
   - Contains detailed job information as if deep-scanned
   - Used by the `/rescan` endpoint when mock mode is enabled
   - Format structure:
     ```json
     [
       {
         "jobId": "senior-node-js-engineer-at-...",  // Unique job identifier
         "timestamp": "2025-07-06T21:03:22.853Z",   // ISO timestamp of scan
         "title": "Senior Node.js Engineer",         // Job title
         "company": "ROSE",                         // Company name
         "location": "New York, NY",                // Job location
         "description": "This is a contract...",    // Full job description
         "requirements": [                          // Extracted key requirements
           "At least three years of relevant Node.js...",
           // Additional requirements...
         ],
         "salary": "$90,000",                       // Salary info (may be null)
         "matchScore": 0.85,                        // AI-generated match score (0-1)
         "matchReason": "The candidate's profile...", // AI explanation of match
         "scanned": true,                           // Whether job was deep-scanned
         "scanDate": "2025-07-06T21:03:22.848Z",    // ISO timestamp of deep scan
         "jobUrl": "https://www.linkedin.com/jobs/..." // Original LinkedIn URL
       },
       // Additional job details...
     ]
     ```

To enable mock mode, you can either:

1. Set `mockMode: true` in `config.json` (persistent setting)
2. Set the `MOCK_DATA=true` environment variable (temporary override)
3. Use the test commands with `:mock` suffix which set the environment variable automatically

## Automated Tasks

The daily cron task runs at 07:00 AEST and automatically:
1. Scrapes LinkedIn for new job listings
2. Updates the job index with new jobs
3. Deep scans any new or unscanned jobs
4. Sends an email digest to the configured recipient

## Data Storage

- **Job Index**: `data/job-index.json` - Persistent storage of all jobs with metadata.
See [Job Index Structure](#job-index-structure) for the fields stored with each job. The file also records `lastScanDate` and a `profileHash` so the system can detect when a rescan is needed.
- **Daily Matches**: `data/YYYY-MM-DD.json` - Daily snapshots of matched jobs (legacy format)
- **Screenshots**: `screenshots/` - Job posting screenshots captured during deep scanning (for debugging)
- **Plan**: `plan.json` - Defines profile text, search terms and deep scan prompt.

## Job Data Structure

When jobs are deep-scanned, the system uses an LLM to process and structure the job data. Here's the structure of a job after deep scanning:

```json
{
  "jobId": "unique-job-identifier",       // Unique identifier for the job
  "timestamp": "2025-07-06T21:03:22.853Z", // When the job was processed
  "title": "Senior Engineer",             // Job title
  "company": "Company Name",              // Company name
  "location": "City, State",              // Job location
  "description": "Full job description...", // Raw job description as scraped from LinkedIn
  "requirements": [                       // Key requirements extracted by the LLM
    "5+ years experience with...",
    "Bachelor's degree in...",
    "Experience with cloud platforms..."
  ],
  "salary": "$90,000-$120,000",           // Salary information if available
  "jobType": "Full-time",                // Job type (full-time, part-time, contract)
  "experienceLevel": "Senior",           // Experience level (entry, mid, senior)
  "remoteStatus": "Hybrid",              // Remote status (remote, hybrid, on-site)
  "companyInfo": {                        // Extracted company information
    "size": "1,000-5,000 employees",      // Company size if mentioned
    "industry": "Software Development",    // Industry sector
    "founded": "2010",                   // Founding year if mentioned
    "description": "Leading tech company..." // Brief company description
  },
  "benefits": [                          // Benefits mentioned in the job posting
    "Health insurance",
    "401(k) matching",
    "Unlimited PTO"
  ],
  "technologies": [                      // Technologies/tools mentioned
    "TypeScript",
    "React",
    "AWS"
  ],
  "matchScore": 0.85,                     // AI-generated match score (0-1)
  "matchReason": "Detailed explanation...", // AI explanation of the match score
  "scanned": true,                        // Whether job was deep-scanned
  "scanDate": "2025-07-06T21:03:22.848Z", // When the job was deep-scanned
  "jobUrl": "https://linkedin.com/jobs/..." // Original job URL
}
```

### How Job Data is Processed

1. **Initial Scraping**: Basic job information is scraped from LinkedIn search results
2. **Deep Scanning**: The system visits each job page to extract the full job description
3. **LLM Processing**: The job description is processed by an LLM to:
   - Extract key requirements as discrete points
   - Identify salary information when available
   - Determine job type (full-time, part-time, contract)
   - Assess experience level (entry, mid, senior)
   - Identify remote work status (remote, hybrid, on-site)
   - Extract company information (size, industry, founding year)
   - Identify benefits mentioned in the job posting
   - Extract technologies and tools mentioned in the description
   - Generate a match score against the candidate profile
   - Provide a detailed explanation of the match

This structured approach allows for more effective filtering, sorting, and matching of job opportunities based on multiple dimensions of job characteristics.

### Raw Job Content Extraction

For development and testing purposes, the system includes a dedicated function to extract and save raw job page content:

```javascript
export async function extractRawJobContent(jobUrl, jobId)
```

This function:
1. Visits the job page using Playwright
2. Extracts the raw HTML and text content
3. Takes a screenshot of the page
4. Saves the following files to help with LLM component development:
   - `data/raw-job-content/{jobId}.json` - Structured raw text content
   - `data/raw-job-content/{jobId}.html` - Complete HTML of the page
   - `data/raw-job-screenshots/{jobId}.png` - Screenshot of the job page

The raw content JSON includes:
```json
{
  "title": "Job title as displayed",
  "company": "Company name",
  "location": "Job location",
  "fullDescription": "Complete job description text",
  "aboutCompany": "Company information if available",
  "timestamp": "2025-07-06T21:03:22.853Z",
  "url": "https://linkedin.com/jobs/..."
}
```

This raw data is invaluable for iterating on and improving the LLM extraction components.
