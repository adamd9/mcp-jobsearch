import { launch } from "@cloudflare/playwright";
import { autoSendDigest, sendScanFailureNotification } from './digest.js';
import { httpPerformDeepScan } from './http-deep-scan.js';
import { SCAN_CONFIG } from './constants.js';

// Generate a unique job ID from URL
export function generateJobId(jobUrl) {
  if (!jobUrl) return null;
  // Extract job ID from LinkedIn URL (e.g., /view/123456/)
  const match = jobUrl.match(/\/view\/(\d+)\//); 
  return match ? match[1] : jobUrl.split('/').pop().split('?')[0];
}

// Store jobs for later deep scanning
export async function storeJobsForDeepScan(env, jobs) {
  try {
    // Get existing job index
    const existingJobs = await env.JOB_STORAGE.get('job_index', 'json') || { jobs: [] };
    
    // Add new jobs, avoiding duplicates
    const existingIds = new Set(existingJobs.jobs.map(j => j.id));
    const newJobs = jobs.filter(job => job.id && !existingIds.has(job.id));
    
    if (newJobs.length > 0) {
      existingJobs.jobs.push(...newJobs);
      existingJobs.lastUpdate = new Date().toISOString();
      
      await env.JOB_STORAGE.put('job_index', JSON.stringify(existingJobs));
      console.log(`Stored ${newJobs.length} new jobs for deep scanning`);
    }
  } catch (error) {
    console.error('Error storing jobs for deep scan:', error);
  }
}

// Main scan function
export async function runScan(agent, url, options = {}) {
  const { sendDigest = true } = options;
  let browser = null;
  
  try {
    let urlsToProcess = [];
    console.log('--- runScan invoked ---');
    if (url) {
      urlsToProcess.push({ url }); // Match the structure of plan.searchUrls
    } else {
      const plan = await agent.env.JOB_STORAGE.get('plan', 'json');
      if (!plan || !plan.searchUrls || plan.searchUrls.length === 0) {
        throw new Error('No URL provided and no searches found in the current plan.');
      }
      urlsToProcess = plan.searchUrls;
      console.log('URLs to scan:', urlsToProcess.map(u => u.url));
      console.log(`Loaded plan with ${plan.searchUrls.length} search URLs`);
    }

    agent.backgroundJobs.scan.status = 'running';
    agent.backgroundJobs.scan.urlsToScan = urlsToProcess.map(u => u.url);

    // Create browser instance for authenticated LinkedIn search (still needed for search results)
    // Note: Deep scan phase now uses HTTP requests instead of browser
    console.log('Launching browser for authenticated LinkedIn search phase...');
    browser = await launch(agent.env.BROWSER);
    const page = await browser.newPage();

    // Block unnecessary resources to improve performance and reduce bandwidth
    await page.route('**/*', (route) => {
      const resourceType = route.request().resourceType();
      const url = route.request().url();
      
      // Block images, stylesheets, fonts, and media files
      if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
        route.abort();
      }
      // Block common tracking and analytics scripts
      else if (url.includes('google-analytics') || url.includes('googletagmanager') || 
               url.includes('facebook.com') || url.includes('doubleclick') ||
               url.includes('ads') || url.includes('analytics')) {
        route.abort();
      }
      else {
        route.continue();
      }
    });
    console.log('Resource blocking configured for improved performance');

    // Login once at the beginning of the scan.
    console.log('Navigating to LinkedIn login page...');
    await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });

    console.log('Entering login credentials...');
    await page.type('#username', agent.env.LINKEDIN_EMAIL);
    await page.type('#password', agent.env.LINKEDIN_PASSWORD);

    console.log('Submitting login form...');
    await page.click('button[type="submit"]');

    console.log('Waiting for login to complete...');
    await page.waitForNavigation({ waitUntil: 'networkidle' }).catch(e => console.log('Navigation timeout after login, continuing...'));

    // Check for security verification right after login attempt
    const postLoginUrl = page.url();
    if (postLoginUrl.includes('checkpoint') || postLoginUrl.includes('security-verification')) {
      console.log(`LinkedIn security check detected at ${postLoginUrl}. The scraper may fail.`);
      agent.backgroundJobs.scan.error = 'LinkedIn security check detected. Manual login in a browser may be required.';
      // It's probably not useful to continue if we hit a checkpoint.
      throw new Error(agent.backgroundJobs.scan.error);
    }

    for (const scanUrl of urlsToProcess) {
      console.log(`Navigating to job search URL: ${scanUrl.url}`);
      await page.goto(scanUrl.url, { waitUntil: 'domcontentloaded' });

      const pageTitle = await page.title();
      const pageUrl = page.url();
      console.log(`Landed on page: "${pageTitle}" at URL: ${pageUrl}`);

      try {
        // 1. Wait for the header to ensure the page is ready.
        await page.waitForSelector('.jobs-search-results-list__header', { timeout: SCAN_CONFIG.PAGE_TIMEOUT });

        // 2. Use the user-provided selector for job cards.
        const jobSelector = '.job-card-list';
        const jobs = await page.$$eval(jobSelector, (els) => {
          // 3. Use the new data extraction logic based on the user's HTML.
          return els.map(el => {
            const titleEl = el.querySelector('a.job-card-list__title--link');
            const companyEl = el.querySelector('.artdeco-entity-lockup__subtitle span');
            // The location is in the first list item of the metadata.
            const locationEl = el.querySelector('.job-card-container__metadata-wrapper li');

            return {
              title: titleEl?.innerText.trim() || null,
              company: companyEl?.innerText.trim() || null,
              location: locationEl?.innerText.trim().replace(/\n/g, ' ').replace(/\s+/g, ' ').trim() || null,
              url: titleEl?.href ? titleEl.href.split('?')[0] : null,
            };
          });
        });

        console.log(`Found ${jobs.length} jobs on this page.`);
        agent.backgroundJobs.scan.totalJobsFound += jobs.length;

        // Store jobs for deep scanning
        if (jobs.length > 0) {
          const jobsWithId = jobs.map(job => ({
            ...job,
            id: generateJobId(job.url),
            searchUrl: scanUrl.url,
            scanned: false,
            scanDate: null,
            matchScore: null
          }));
          
          // Store jobs in KV for later deep scan
          await storeJobsForDeepScan(agent.env, jobsWithId);
        }

      } catch (selectorError) {
          console.log(`Could not find job list using the new selectors: ${selectorError.message}`);
          agent.backgroundJobs.scan.error = `Failed to find job list on page. The layout may have changed.`;
      }

      agent.backgroundJobs.scan.scannedUrls.push(scanUrl.url);
      console.log('Continuing to next step after trying to scrape...');
    }

    // After all search URLs are processed, start deep scan phase
    console.log('Starting HTTP-based deep scan phase (no browser needed)...');
    agent.backgroundJobs.scan.status = 'deep_scanning';
    
    // Use HTTP-based deep scan instead of browser-based approach
    await httpPerformDeepScan(agent);
    
    // Set status to completed before closing the browser to ensure state is updated.
    agent.backgroundJobs.scan.status = 'completed';
    agent.backgroundJobs.scan.endTime = new Date().toISOString();
    agent.backgroundJobs.scan.inProgress = false;
    
    console.log('Scan completed successfully');
    
    // Auto-send digest if requested
    if (sendDigest) {
      const digestResult = await autoSendDigest(agent.env, { source: 'scan' });
      if (digestResult.success) {
        console.log(`Auto-digest sent successfully: ${digestResult.jobsSent} jobs`);
      } else {
        console.log(`Auto-digest failed: ${digestResult.error}`);
      }
    }
  } catch (error) {
    console.error('Error in runScan:', error);
    agent.backgroundJobs.scan.error = error.message;
    agent.backgroundJobs.scan.status = 'failed';
    agent.backgroundJobs.scan.inProgress = false;
    agent.backgroundJobs.scan.endTime = new Date().toISOString();
    
    // Send failure notification email unless sendDigest is false
    if (sendDigest) {
      try {
        const failureResult = await sendScanFailureNotification(agent.env, error.message);
        if (failureResult.success) {
          console.log('Failure notification sent successfully');
        } else {
          console.log(`Failed to send failure notification: ${failureResult.error}`);
        }
      } catch (digestError) {
        console.error('Error sending failure notification:', digestError);
      }
    }
  } finally {
    // Ensure browser is always closed, even on error
    if (browser) {
      try {
        console.log('Closing browser...');
        await browser.close();
        console.log('Browser closed successfully');
      } catch (closeError) {
        console.error('Error closing browser:', closeError.message);
      }
    }
  }
}


