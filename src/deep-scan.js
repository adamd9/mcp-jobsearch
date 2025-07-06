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
    // Try different selectors for job details
    const selectors = {
      title: [
        '.jobs-unified-top-card__job-title',
        '.job-details-jobs-unified-top-card__job-title',
        'h1.topcard__title'
      ],
      company: [
        '.jobs-unified-top-card__company-name',
        '.job-details-jobs-unified-top-card__company-name',
        'a.topcard__org-name-link'
      ],
      location: [
        '.jobs-unified-top-card__bullet',
        '.job-details-jobs-unified-top-card__bullet',
        '.topcard__flavor--bullet'
      ],
      description: [
        '.jobs-description-content',
        '.job-details-jobs-unified-top-card__description-container',
        '.description__text'
      ]
    };
    
    // Helper function to try multiple selectors
    const getTextFromSelectors = async (selectorList) => {
      for (const selector of selectorList) {
        try {
          const element = await page.$(selector);
          if (element) {
            return await element.innerText();
          }
        } catch (e) {
          // Continue to next selector
        }
      }
      return null;
    };
    
    // Extract job details
    const title = await getTextFromSelectors(selectors.title);
    const company = await getTextFromSelectors(selectors.company);
    const location = await getTextFromSelectors(selectors.location);
    const description = await getTextFromSelectors(selectors.description);
    
    // Extract requirements (skills, experience, etc.)
    const requirements = await extractRequirements(description);
    
    // Extract salary information if available
    const salary = await extractSalary(description);
    
    return {
      title: title?.trim(),
      company: company?.trim(),
      location: location?.trim(),
      description: description?.trim(),
      requirements,
      salary
    };
  } catch (error) {
    console.error(`Error extracting job details: ${error.message}`);
    return {};
  }
}

/**
 * Extract requirements from job description
 * @param {string} description - Job description
 * @returns {Array} - List of requirements
 */
function extractRequirements(description) {
  if (!description) return [];
  
  // Look for common patterns in job descriptions
  const requirements = [];
  
  // Look for bullet points
  const bulletPoints = description.match(/[•\-\*]\s*([^\n•\-\*]+)/g);
  if (bulletPoints) {
    bulletPoints.forEach(point => {
      const cleaned = point.replace(/[•\-\*]\s*/, '').trim();
      if (cleaned) requirements.push(cleaned);
    });
  }
  
  // Look for "Requirements:", "Qualifications:", etc.
  const sections = [
    'Requirements', 'Qualifications', 'Skills', 'Experience',
    'What You\'ll Need', 'What You Need', 'Must Have'
  ];
  
  sections.forEach(section => {
    const regex = new RegExp(`${section}[:\\s]([\\s\\S]*?)(?:(?:${sections.join('|')})[:\\s]|$)`, 'i');
    const match = description.match(regex);
    if (match && match[1]) {
      const sectionText = match[1].trim();
      const sectionPoints = sectionText.split(/\n+/).map(p => p.trim()).filter(p => p);
      requirements.push(...sectionPoints);
    }
  });
  
  // Remove duplicates
  return [...new Set(requirements)];
}

/**
 * Extract salary information from job description
 * @param {string} description - Job description
 * @returns {string|null} - Salary information
 */
function extractSalary(description) {
  if (!description) return null;
  
  // Common salary patterns
  const salaryPatterns = [
    /\$\s*\d{1,3}(?:,\d{3})*(?:\s*-\s*\$\s*\d{1,3}(?:,\d{3})*)?(?:\s*(?:k|thousand|million|m|per year|\/year|annual|annually|p\.a\.|pa))?/gi,
    /(?:salary|compensation|pay)(?:\s*range)?(?:\s*:)?\s*\$\s*\d{1,3}(?:,\d{3})*(?:\s*-\s*\$\s*\d{1,3}(?:,\d{3})*)?/gi,
    /(?:salary|compensation|pay)(?:\s*range)?(?:\s*:)?\s*\d{1,3}(?:,\d{3})*(?:\s*-\s*\d{1,3}(?:,\d{3})*)?(?:\s*(?:k|thousand|million|m))/gi
  ];
  
  for (const pattern of salaryPatterns) {
    const match = description.match(pattern);
    if (match) {
      return match[0].trim();
    }
  }
  
  return null;
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
 * @returns {Promise<Array>} - Scan results
 */
export async function deepScanJobs(jobs, profile, concurrency = 2, scanPrompt = '', progressCallback = null, auditLogger = null) {
  console.log(`Deep scanning ${jobs.length} jobs with concurrency ${concurrency}`);
  
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
  for (let i = 0; i < jobs.length; i += concurrency) {
    const batch = jobs.slice(i, i + concurrency);
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
    
    console.log(`Completed batch ${Math.floor(i/concurrency) + 1}/${Math.ceil(jobs.length/concurrency)} (${i + batch.length}/${jobs.length} jobs)`);
    
    // Small delay between batches to avoid rate limiting
    if (i + concurrency < jobs.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return results;
}
