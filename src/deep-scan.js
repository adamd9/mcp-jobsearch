import { chromium } from "playwright";
import OpenAI from "openai";
import dotenv from "dotenv";
import fs from "fs/promises";
import { markJobAsScanned } from "./storage.js";

dotenv.config();

// Configure OpenAI API
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Deep scan a job posting and match it against the profile
 * @param {string} jobUrl - URL of the job posting
 * @param {string} jobId - ID of the job
 * @param {string} profile - User profile text
 * @param {string} scanPrompt - Additional criteria for job matching
 * @param {Object} auditLogger - Optional audit logger instance
 * @returns {Promise<Object>} - Scan results
 */
export async function deepScanJob(jobUrl, jobId, profile, scanPrompt = '', auditLogger = null) {
  console.log(`Deep scanning job: ${jobUrl}`);
  
  const browser = await chromium.launch({ 
    headless: true // Run headless for deep scanning
  });
  
  try {
    const page = await browser.newPage();
    
    // Block unnecessary resources to speed up loading
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (
        url.includes('linkedin.com/jobs') || 
        url.includes('linkedin.com/voyager/api')
      ) {
        route.continue();
      } else {
        route.abort();
      }
    });
    
    // Navigate to the job page
    await page.goto(jobUrl, { 
      timeout: 30000,
      waitUntil: "domcontentloaded"
    });
    
    // Wait for job details to load
    await page.waitForSelector('.job-details, .jobs-description, .jobs-description-content', { 
      timeout: 10000 
    }).catch(() => console.log('Could not find job details container, continuing anyway...'));
    
    // Extract job details
    const jobDetails = await extractJobDetails(page);
    
    // Take screenshot for audit logging and debugging
    const screenshotBuffer = await page.screenshot();
    
    // Save screenshot locally for debugging
    await fs.writeFile(`data/job-screenshots/${jobId}.png`, screenshotBuffer);
    
    // Log screenshot to audit log if enabled
    if (auditLogger) {
      await auditLogger.logScreenshot(`job-${jobId}`, screenshotBuffer);
    }
    
    // Match job to profile
    const matchResults = await matchJobToProfile(jobDetails, profile, scanPrompt);
    
    // Close the browser
    await browser.close();
    
    // Combine job details and match results
    const scanResults = {
      ...jobDetails,
      ...matchResults,
      scanned: true,
      scanDate: new Date().toISOString(),
      jobUrl
    };
    
    // Log job details to audit log if enabled
    if (auditLogger) {
      await auditLogger.logJobDetails(jobId, scanResults);
    }
    
    // Update job in index
    await markJobAsScanned(jobId, scanResults);
    
    return scanResults;
  } catch (error) {
    console.error(`Error deep scanning job ${jobUrl}: ${error.message}`);
    await browser.close();
    
    // Mark as scanned but with error
    const errorResult = {
      scanned: true,
      scanDate: new Date().toISOString(),
      error: error.message,
      matchScore: 0,
      jobUrl
    };
    
    // Log error to audit log if enabled
    if (auditLogger) {
      await auditLogger.logJobDetails(jobId, errorResult);
    }
    
    await markJobAsScanned(jobId, errorResult);
    
    return errorResult;
  }
}

/**
 * Extract detailed job information from the job page
 * @param {Page} page - Playwright page object
 * @returns {Promise<Object>} - Job details
 */
async function extractJobDetails(page) {
  try {
    // Extract the full page content
    const htmlContent = await page.content();
    
    // Extract basic visible text content for fallback and debugging
    const basicVisibleContent = await page.evaluate(() => {
      // Get the main content area, or body if no specific container is found
      const mainContent = document.querySelector(
        '.jobs-description-content, .job-details, .job-view-layout, .description, main, article'
      ) || document.body;
      
      // Return the text content
      return mainContent.innerText;
    });
    
    // Get the current URL
    const currentUrl = page.url();
    
    // Get the page title
    const pageTitle = await page.title();
    
    // Create raw job data object
    const rawJobData = {
      url: currentUrl,
      pageTitle: pageTitle,
      htmlContent: htmlContent,
      textContent: basicVisibleContent,
      timestamp: new Date().toISOString()
    };
    
    // Use LLM to extract structured data from the raw job content
    const structuredData = await extractStructuredJobData(rawJobData);
    
    // Return the structured data
    return structuredData;
  } catch (error) {
    console.error(`Error extracting job details: ${error.message}`);
    return {};
  }
}

/**
 * Extract structured job data from raw job content using LLM
 * @param {Object} rawJobData - Raw job data including HTML and text content
 * @returns {Promise<Object>} - Structured job data
 */
async function extractStructuredJobData(rawJobData) {
  try {
    const { url, pageTitle, textContent } = rawJobData;
    
    // Skip if we don't have enough information
    if (!textContent) {
      return { 
        title: pageTitle || null,
        company: null,
        location: null,
        description: null,
        requirements: [], 
        salary: null,
        jobType: null,
        experienceLevel: null,
        remoteStatus: null,
        companyInfo: {
          size: null,
          industry: null,
          founded: null,
          description: null
        },
        benefits: [],
        technologies: []
      };
    }
    
    // Prepare the prompt for OpenAI
    const prompt = `
You are a job analysis expert. Extract structured information from this job posting.

JOB PAGE URL: ${url}
PAGE TITLE: ${pageTitle || 'N/A'}

RAW JOB CONTENT:
${textContent.substring(0, 15000)}

Extract and provide the following information in JSON format:
1. Job title (as a string)
2. Company name (as a string)
3. Job location (as a string)
4. Job description summary (as a string, max 200 words)
5. A list of key requirements/qualifications (as an array of strings)
6. Salary information if mentioned (as a string, or null if not found)
7. Job type (full-time, part-time, contract, etc.)
8. Experience level (entry, mid, senior, etc.)
9. Remote status (remote, hybrid, on-site)
10. Company information (size, industry, founding year if mentioned)
11. Benefits mentioned (as an array of strings)
12. Technologies/tools mentioned (as an array of strings)

Provide your analysis in the following JSON format:
{
  "title": "job title",
  "company": "company name",
  "location": "job location",
  "description": "job description summary",
  "requirements": ["requirement 1", "requirement 2", ...],
  "salary": "salary information or null",
  "jobType": "job type or null",
  "experienceLevel": "experience level or null",
  "remoteStatus": "remote status or null",
  "companyInfo": {
    "size": "company size or null",
    "industry": "company industry or null",
    "founded": "founding year or null",
    "description": "brief company description or null"
  },
  "benefits": ["benefit 1", "benefit 2", ...],
  "technologies": ["technology 1", "technology 2", ...]
}
`;

    // Call OpenAI API
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o",
      messages: [
        { role: "system", content: "You are a job analysis expert that extracts structured information from job descriptions." },
        { role: "user", content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 1000
    });
    
    // Parse the response
    const content = response.choices[0].message.content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      try {
        const result = JSON.parse(jsonMatch[0]);
        return {
          title: result.title || pageTitle || null,
          company: result.company || null,
          location: result.location || null,
          description: result.description || null,
          requirements: Array.isArray(result.requirements) ? result.requirements : [],
          salary: result.salary || null,
          jobType: result.jobType || null,
          experienceLevel: result.experienceLevel || null,
          remoteStatus: result.remoteStatus || null,
          companyInfo: result.companyInfo || {
            size: null,
            industry: null,
            founded: null,
            description: null
          },
          benefits: Array.isArray(result.benefits) ? result.benefits : [],
          technologies: Array.isArray(result.technologies) ? result.technologies : []
        };
      } catch (e) {
        console.error("Error parsing OpenAI structured data response:", e);
      }
    }
    
    // Fallback if parsing fails
    return { 
      title: pageTitle || null,
      company: null,
      location: null,
      description: null,
      requirements: [], 
      salary: null,
      jobType: null,
      experienceLevel: null,
      remoteStatus: null,
      companyInfo: {
        size: null,
        industry: null,
        founded: null,
        description: null
      },
      benefits: [],
      technologies: []
    };
  } catch (error) {
    console.error(`Error extracting structured job data: ${error.message}`);
    return { 
      title: pageTitle || null,
      company: null,
      location: null,
      description: null,
      requirements: [], 
      salary: null,
      jobType: null,
      experienceLevel: null,
      remoteStatus: null,
      companyInfo: {
        size: null,
        industry: null,
        founded: null,
        description: null
      },
      benefits: [],
      technologies: []
    };
  }
}

/**
 * Extract and save raw job page content for development purposes
 * This function is meant to be used during development to capture real LinkedIn job page content
 * for testing and improving the LLM extraction components
 * @param {string} jobUrl - URL of the job posting
 * @param {string} jobId - ID of the job
 * @returns {Promise<Object>} - Raw job page content
 */
export async function extractRawJobContent(jobUrl, jobId) {
  console.log(`Extracting raw content from job: ${jobUrl}`);
  
  const browser = await chromium.launch({ 
    headless: true
  });
  
  try {
    const page = await browser.newPage();
    
    // Navigate to the job page
    await page.goto(jobUrl, { 
      timeout: 30000,
      waitUntil: "domcontentloaded"
    });
    
    // Wait for job details to load
    await page.waitForSelector('.job-details, .jobs-description, .jobs-description-content', { 
      timeout: 10000 
    }).catch(() => console.log('Could not find job details container, continuing anyway...'));
    
    // Take screenshot
    const screenshotBuffer = await page.screenshot();
    
    // Ensure directories exist
    await fs.mkdir('data/raw-job-content', { recursive: true });
    await fs.mkdir('data/raw-job-screenshots', { recursive: true });
    
    // Extract HTML content
    const htmlContent = await page.content();
    
    // Extract text content from different sections
    const rawContent = {
      title: await page.evaluate(() => {
        const titleEl = document.querySelector('.jobs-unified-top-card__job-title, .job-details-jobs-unified-top-card__job-title, h1.topcard__title');
        return titleEl ? titleEl.innerText : null;
      }),
      company: await page.evaluate(() => {
        const companyEl = document.querySelector('.jobs-unified-top-card__company-name, .job-details-jobs-unified-top-card__company-name, a.topcard__org-name-link');
        return companyEl ? companyEl.innerText : null;
      }),
      location: await page.evaluate(() => {
        const locationEl = document.querySelector('.jobs-unified-top-card__bullet, .job-details-jobs-unified-top-card__bullet, .topcard__flavor--bullet');
        return locationEl ? locationEl.innerText : null;
      }),
      fullDescription: await page.evaluate(() => {
        const descEl = document.querySelector('.jobs-description-content, .job-details-jobs-unified-top-card__description-container, .description__text');
        return descEl ? descEl.innerText : null;
      }),
      aboutCompany: await page.evaluate(() => {
        const aboutEl = document.querySelector('.jobs-company__box, .company-panel, .topcard__org-info-data');
        return aboutEl ? aboutEl.innerText : null;
      }),
      timestamp: new Date().toISOString(),
      url: jobUrl
    };
    
    // Save raw content to file
    await fs.writeFile(
      `data/raw-job-content/${jobId}.json`, 
      JSON.stringify(rawContent, null, 2)
    );
    
    // Save screenshot
    await fs.writeFile(`data/raw-job-screenshots/${jobId}.png`, screenshotBuffer);
    
    // Save full HTML for reference
    await fs.writeFile(`data/raw-job-content/${jobId}.html`, htmlContent);
    
    console.log(`Raw job content saved for ${jobId}`);
    
    await browser.close();
    return rawContent;
  } catch (error) {
    console.error(`Error extracting raw job content: ${error.message}`);
    await browser.close();
    return { error: error.message };
  }
}

/**
 * Match job details to user profile using OpenAI
 * @param {Object} jobDetails - Job details
 * @param {string} profile - User profile
 * @returns {Promise<Object>} - Match results
 */
async function matchJobToProfile(jobDetails, profile, scanPrompt = '') {
  try {
    // Prepare job details for OpenAI
    const { title, company, location, description, requirements, salary } = jobDetails;
    
    // Skip if we don't have enough information
    if (!title || !description) {
      return { matchScore: 0, matchReason: "Insufficient job details" };
    }
    
    // Prepare the prompt for OpenAI
    const prompt = `
You are a job matching expert. Analyze the job details below and compare them to the candidate's profile.
${scanPrompt ? `Additional criteria:\n${scanPrompt}\n` : ''}Provide a match score from 0 to 1 (where 1 is a perfect match) and explain your reasoning.

JOB DETAILS:
Title: ${title || 'N/A'}
Company: ${company || 'N/A'}
Location: ${location || 'N/A'}
${salary ? `Salary: ${salary}` : ''}

Description:
${description || 'N/A'}

${requirements.length > 0 ? `Key Requirements:\n${requirements.join('\n')}` : ''}

CANDIDATE PROFILE:
${profile}

Provide your analysis in the following JSON format:
{
  "matchScore": [number between 0 and 1],
  "matchReason": [detailed explanation of why this job matches or doesn't match the candidate's profile]
}
`;

    // Call OpenAI API
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o",
      messages: [
        { role: "system", content: "You are a job matching expert that analyzes job postings and candidate profiles." },
        { role: "user", content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 1000
    });
    
    // Parse the response
    const content = response.choices[0].message.content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      try {
        const result = JSON.parse(jsonMatch[0]);
        return {
          matchScore: result.matchScore,
          matchReason: result.matchReason
        };
      } catch (e) {
        console.error("Error parsing OpenAI response:", e);
      }
    }
    
    // Fallback if parsing fails
    return { 
      matchScore: 0.5, 
      matchReason: "Could not determine match score automatically." 
    };
  } catch (error) {
    console.error(`Error matching job to profile: ${error.message}`);
    return { 
      matchScore: 0, 
      matchReason: `Error: ${error.message}` 
    };
  }
}

/**
 * Deep scan multiple jobs concurrently
 * @param {Array} jobs - Array of jobs to scan
 * @param {string} profile - User profile
 * @param {number} concurrency - Number of concurrent scans
 * @param {string} scanPrompt - Additional criteria for job matching
 * @param {Function} progressCallback - Optional callback function to report progress
 * @param {Object} auditLogger - Optional audit logger instance
 * @param {number} limit - Maximum number of jobs to scan (default: 50)
 * @returns {Promise<Array>} - Scan results
 */
export async function deepScanJobs(jobs, profile, concurrency = 2, scanPrompt = '', progressCallback = null, auditLogger = null, limit = 50) {
  // Apply limit if provided
  const jobsToScan = limit > 0 && jobs.length > limit ? jobs.slice(0, limit) : jobs;
  
  console.log(`Deep scanning ${jobsToScan.length} jobs with concurrency ${concurrency}${limit > 0 && jobs.length > limit ? ` (limited from ${jobs.length} total jobs)` : ''}`);
  
  // Ensure screenshots directory exists
  try {
    await fs.mkdir('data/job-screenshots', { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      console.error(`Error creating screenshots directory: ${error.message}`);
    }
  }
  
  // Process jobs in batches to control concurrency
  const results = [];
  for (let i = 0; i < jobsToScan.length; i += concurrency) {
    const batch = jobsToScan.slice(i, i + concurrency);
    const batchPromises = batch.map(job =>
      deepScanJob(job.link, job.id, profile, scanPrompt, auditLogger)
        .then(result => {
          // Call progress callback if provided
          if (typeof progressCallback === 'function') {
            progressCallback(job.id, result);
          }
          return result;
        })
    );
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    
    console.log(`Completed batch ${Math.floor(i/concurrency) + 1}/${Math.ceil(jobsToScan.length/concurrency)} (${i + batch.length}/${jobsToScan.length} jobs)`);
    
    // Small delay between batches to avoid rate limiting
    if (i + concurrency < jobsToScan.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return results;
}
