# LinkedIn Job Scraper Enhancement Plan

## Overview

This document outlines the plan for enhancing the LinkedIn job scraper with the following features:
- Persistent job index storage
- Deep scanning of job postings against profile criteria
- Deduplication of job scanning
- Additional API endpoints
- Test cases with LinkedIn result stubs

## 1. Job Index Storage

### Implementation

1. Create a `src/storage.js` module with the following functions:
   - `saveJobIndex(jobs)` - Save the job index to a JSON file
   - `getJobIndex()` - Get the current job index
   - `updateJobStatus(jobId, status)` - Update the status of a job in the index
   - `markJobAsScanned(jobId)` - Mark a job as having been deep scanned

2. Job index structure:
```json
{
  "jobs": [
    {
      "id": "unique-job-id", // Derived from LinkedIn job URL
      "title": "Job Title",
      "company": "Company Name",
      "link": "https://linkedin.com/jobs/view/...",
      "posted": "2025-06-09",
      "scanned": true, // Whether the job has been deep scanned
      "scanDate": "2025-07-05T12:00:00+10:00", // When the job was last scanned
      "matchScore": 0.85, // Score from 0-1 indicating match quality
      "matchReason": "This job matches your profile because...",
      "description": "Full job description from deep scan",
      "requirements": ["Skill 1", "Skill 2"], // Extracted requirements
      "location": "Sydney, Australia",
      "salary": "$100,000 - $120,000"
    }
  ],
  "lastScanDate": "2025-07-05T12:00:00+10:00",
  "profileHash": "abc123" // Hash of profile.txt to detect changes
}
```

3. Store the job index in a `data/job-index.json` file

## 2. Deep Scanning Logic

### Implementation

1. Create a `src/deep-scan.js` module with the following functions:
   - `deepScanJob(jobUrl, profile)` - Scrape detailed job info and match against profile
   - `extractJobDetails(page)` - Extract detailed job information from the job page
   - `matchJobToProfile(jobDetails, profile)` - Use OpenAI to match job to profile

2. Enhance the existing `filter.js` module to work with the deep scan results

3. Process flow:
   - Initial scrape gets basic job listings (title, link, posted date)
   - Deep scan visits each job page to extract full details
   - OpenAI evaluates job details against profile.txt
   - Results are stored in the job index

## 3. Deduplication Logic

### Implementation

1. Enhance `src/scrape.js` to check the job index before deep scanning:
   - Compare new job listings against the job index
   - Only deep scan jobs that are new or have been requested for re-scan
   - Use the job URL as a unique identifier

2. Add a force rescan option:
   - When profile.txt changes (detect via hash comparison)
   - When explicitly requested via API

## 4. New API Endpoints

### Implementation

1. Add to `src/server.js`:
   - `GET /scan` - Trigger a scan without sending a digest
   - `POST /rescan` - Force a deep rescan of all jobs in the index
   - `GET /job/:id` - Get details for a specific job
   - `GET /jobs` - Get all jobs with optional filtering

2. Update the existing endpoints:
   - `GET /latest_matches` - Return jobs from the index instead of the daily file
   - `POST /send_digest` - Use the job index for generating the digest

## 5. Test Cases

### Implementation

1. Create a `test` directory with the following:
   - `fixtures/linkedin-search-results.json` - Sample search results
   - `fixtures/linkedin-job-details.json` - Sample job details
   - `fixtures/profile-samples.txt` - Sample profiles for testing

2. Create test modules:
   - `test/scrape.test.js` - Test the scraping logic with stubs
   - `test/deep-scan.test.js` - Test the deep scanning logic
   - `test/filter.test.js` - Test the filtering logic
   - `test/storage.test.js` - Test the storage logic
   - `test/server.test.js` - Test the API endpoints

3. Use Jest or Mocha for testing framework

## 6. Implementation Phases

### Phase 1: Core Infrastructure
- Implement job index storage
- Update scraping to store results in the index
- Add basic deduplication

### Phase 2: Deep Scanning
- Implement deep scanning logic
- Enhance filtering with detailed job information
- Add profile hash comparison

### Phase 3: API Endpoints
- Add new endpoints
- Update existing endpoints to use the job index

### Phase 4: Testing
- Create test fixtures
- Implement test cases
- Add CI/CD integration

## 7. Dependencies

- Add any new dependencies to package.json:
  - crypto (for hashing profile.txt)
  - jest or mocha (for testing)
  - cheerio (for HTML parsing in tests)

## 8. Configuration

- Add new environment variables to .env:
  - `JOB_INDEX_PATH` - Path to job index file
  - `DEEP_SCAN_CONCURRENCY` - Number of concurrent deep scans
  - `FORCE_RESCAN` - Force rescan of all jobs (true/false)
