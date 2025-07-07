#!/usr/bin/env node

/**
 * Script to extract raw job content from LinkedIn for development purposes
 * Usage: node extract-raw-job.js <job-url> [job-id]
 * If job-id is not provided, it will be extracted from the URL
 */

import { extractRawJobContent } from '../src/deep-scan.js';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  // Get job URL from command line arguments
  const jobUrl = process.argv[2];
  
  if (!jobUrl) {
    console.error('Please provide a job URL as the first argument');
    console.error('Usage: node extract-raw-job.js <job-url> [job-id]');
    process.exit(1);
  }
  
  // Extract job ID from URL or use provided ID
  let jobId = process.argv[3];
  
  if (!jobId) {
    // Try to extract job ID from URL
    const match = jobUrl.match(/\/view\/([^\/]+)/);
    if (match && match[1]) {
      jobId = match[1];
    } else {
      // Use a timestamp as fallback
      jobId = `job-${Date.now()}`;
    }
  }
  
  console.log(`Extracting raw content for job: ${jobId}`);
  console.log(`URL: ${jobUrl}`);
  
  try {
    const result = await extractRawJobContent(jobUrl, jobId);
    console.log(`Raw content extracted successfully and saved to:`);
    console.log(`- data/raw-job-content/${jobId}.json`);
    console.log(`- data/raw-job-content/${jobId}.html`);
    console.log(`- data/raw-job-screenshots/${jobId}.png`);
  } catch (error) {
    console.error(`Error extracting raw job content: ${error.message}`);
    process.exit(1);
  }
}

main().catch(console.error);
