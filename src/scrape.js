import { chromium } from "playwright";
import fs from 'fs/promises';
import path from 'path';
import { updateJobIndex, generateJobId, getJobsToScan, hasProfileChanged } from './storage.js';
import { deepScanJobs } from './deep-scan.js';

export async function scrapeLinkedIn(url, options = {}) {
  const { keepOpen = false, debug = false, deepScan = false, forceRescan = false, profileText = null, scanPrompt = '' } = options;
  console.log(`Starting LinkedIn scrape for URL: ${url}`);
  console.log(`Debug mode: ${debug ? 'ON' : 'OFF'}, Keep browser open: ${keepOpen ? 'YES' : 'NO'}`);
  
  // Set headless to false for debugging to see the browser
  const browser = await chromium.launch({ 
    headless: false,
    slowMo: debug ? 100 : 0, // Slow down actions by 100ms in debug mode
  });
  const page = await browser.newPage();
  
  // Block all unnecessary requests to reduce noise
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (
      url.includes('linkedin.com/jobs') || 
      url.includes('linkedin.com/login') ||
      url.includes('linkedin.com/voyager/api')
    ) {
      route.continue();
    } else {
      route.abort();
    }
  });
  
  // Only log critical errors
  page.on('pageerror', err => console.error(`BROWSER ERROR: ${err.message}`));
  
  console.log('Navigating to LinkedIn login page...');
  await page.goto("https://www.linkedin.com/login");
  
  console.log('Entering login credentials...');
  await page.type("#username", process.env.LINKEDIN_EMAIL);
  await page.type("#password", process.env.LINKEDIN_PASSWORD);
  
  console.log('Submitting login form...');
  await page.click("[type=submit]");
  
  // Wait for navigation after login
  console.log('Waiting for login to complete...');
  await page.waitForNavigation({ waitUntil: 'networkidle' }).catch(e => console.log('Navigation timeout, continuing...'));
  
  // Check if login was successful
  const currentUrl = page.url();
  console.log(`Current URL after login attempt: ${currentUrl}`);
  
  if (currentUrl.includes('checkpoint') || currentUrl.includes('add-phone') || currentUrl.includes('security-verification')) {
    console.log('LinkedIn security check detected. Manual intervention may be required.');
    // Wait longer for potential manual intervention
    await page.waitForTimeout(10000);
  }
  
  console.log(`Navigating to job search URL: ${url}`);
  try {
    // Use a shorter timeout and don't wait for networkidle which can be problematic
    await page.goto(url, { timeout: 60000, waitUntil: "domcontentloaded" });
    
    // Wait for the job listings to be visible with a more generous timeout
    console.log('Waiting for job listings to load...');
    await page.waitForSelector('.jobs-search-results-list, .jobs-search__results-list', { timeout: 10000 })
      .catch(() => console.log('Could not find job listings container, continuing anyway...'));
    
    // Take screenshot after basic content is loaded
    console.log('Taking screenshot for debugging...');
    await page.screenshot({ path: 'debug-linkedin.png' });
    
    // Give the page a bit more time to fully load
    console.log('Waiting a bit longer for page to stabilize...');
    await page.waitForTimeout(5000);
  } catch (error) {
    console.log(`Navigation error: ${error.message}`);
    // Take screenshot even if there was an error
    console.log('Taking screenshot after error...');
    await page.screenshot({ path: 'debug-linkedin-error.png' });
  }
  
  console.log('Extracting job listings...');
  // Try different selectors that LinkedIn might be using
  const selectors = [
    // Modern LinkedIn selectors
    ".jobs-search-results__list-item",
    ".job-search-card", 
    // Older selectors
    "ul.jobs-search-results__list li",
    ".jobs-search-results-list__list-item",
    ".jobs-search__results-list li"
  ];
  
  let jobs = [];
  for (const selector of selectors) {
    console.log(`Trying selector: ${selector}`);
    const elements = await page.$$(selector);
    console.log(`Found ${elements.length} elements with selector ${selector}`);
    
    if (elements.length > 0) {
      try {
        jobs = await page.$$eval(selector, els =>
          els.map(el => {
            // Try multiple possible selectors for each field
            const titleSelectors = [
              "h3.base-search-card__title",
              ".job-card-list__title",
              ".job-card-container__link-wrapper h3",
              "h3"
            ];
            
            const linkSelectors = [
              ".base-card__full-link",
              ".job-card-container__link",
              "a.job-card-list__title",
              "a"
            ];
            
            const postedSelectors = [
              "time",
              ".job-search-card__listdate",
              ".job-card-container__metadata-item--posted-date",
              ".job-card-container__footer-item"
            ];
            
            // Find title
            let title = null;
            for (const titleSelector of titleSelectors) {
              const titleElement = el.querySelector(titleSelector);
              if (titleElement?.innerText) {
                title = titleElement.innerText.trim();
                break;
              }
            }
            
            // Find link
            let link = null;
            for (const linkSelector of linkSelectors) {
              const linkElement = el.querySelector(linkSelector);
              if (linkElement?.href) {
                link = linkElement.href.split("?")[0];
                break;
              }
            }
            
            // Find posted date
            let posted = null;
            for (const postedSelector of postedSelectors) {
              const postedElement = el.querySelector(postedSelector);
              if (postedElement) {
                posted = postedElement.dateTime || postedElement.innerText?.trim();
                break;
              }
            }
            
            return { title, link, posted };
          })
        );
        console.log(`Successfully extracted job data using selector: ${selector}`);
        break;
      } catch (error) {
        console.log(`Error extracting data with selector ${selector}: ${error.message}`);
      }
    }
  }
  
  // Process the jobs and update the job index
  console.log(`Found ${jobs.length} job listings`);
  
  // Enhance jobs with IDs and additional metadata
  const enhancedJobs = jobs.map(job => ({
    ...job,
    id: generateJobId(job.link),
    company: job.company || extractCompanyFromTitle(job.title),
    scrapedDate: new Date().toISOString()
  }));
  
  // Update the job index with the new jobs
  const jobIndex = await updateJobIndex(enhancedJobs, forceRescan);
  
  // Display sample of jobs found
  if (jobs.length > 0) {
    console.log('Sample of jobs found:');
    console.log('\nJob 1:');
    console.log(`Title: ${jobs[0].title}`);
    console.log(`Link: ${jobs[0].link}`);
    console.log(`Posted: ${jobs[0].posted}`);
    
    if (jobs.length > 1) {
      console.log('\nJob 2:');
      console.log(`Title: ${jobs[1].title}`);
      console.log(`Link: ${jobs[1].link}`);
      console.log(`Posted: ${jobs[1].posted}`);
    }
    
    if (jobs.length > 2) {
      console.log('\nJob 3:');
      console.log(`Title: ${jobs[2].title}`);
      console.log(`Link: ${jobs[2].link}`);
      console.log(`Posted: ${jobs[2].posted}`);
    }
  }
  
  // Perform deep scanning if requested
  if (deepScan) {
    try {
      // Check if profile has changed
      let profile = profileText;
      if (!profile) {
        const profilePath = path.join(process.cwd(), 'profile.txt');
        profile = await fs.readFile(profilePath, 'utf8');
      }
      
      // Get jobs that need scanning
      const profileChanged = await hasProfileChanged(profile);
      const jobsToScan = await getJobsToScan(profileChanged || forceRescan);
      
      console.log(`\nDeep scanning ${jobsToScan.length} jobs${profileChanged ? ' (profile changed)' : ''}${forceRescan ? ' (force rescan)' : ''}`);
      
      if (jobsToScan.length > 0) {
        // Close the browser before deep scanning to free up resources
        if (!keepOpen) {
          await browser.close();
        }
        
        // Deep scan the jobs
        const concurrency = parseInt(process.env.DEEP_SCAN_CONCURRENCY || '2');
        await deepScanJobs(jobsToScan, profile, concurrency, scanPrompt);
        
        console.log('Deep scanning complete');
      } else {
        console.log('No jobs need deep scanning');
      }
    } catch (error) {
      console.error(`Error during deep scanning: ${error.message}`);
    }
  }
  
  if (keepOpen) {
    console.log('\nKeeping browser open for manual inspection. Close the browser window when done.');
    return { jobs: enhancedJobs, browser };
  } else {
    await browser.close();
    return { jobs: enhancedJobs };
  }
}

/**
 * Extract company name from job title if possible
 * @param {string} title - Job title
 * @returns {string|null} - Company name or null
 */
function extractCompanyFromTitle(title) {
  if (!title) return null;
  
  // Look for "at Company" pattern
  const atMatch = title.match(/\bat\s+([^\s]+(?:\s+[^\s]+){0,3})$/i);
  if (atMatch) {
    return atMatch[1].trim();
  }
  
  return null;
}
