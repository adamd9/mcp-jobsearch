import { launch } from "@cloudflare/playwright";
import { autoSendDigest, sendScanFailureNotification } from './digest.js';
import { deepScanSingleJob } from './deep-scan.js';

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

    // Create browser instance that will be reused throughout scan and deep scan
    console.log('Launching browser for scan and deep scan phases...');
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
        await page.waitForSelector('.jobs-search-results-list__header', { timeout: 10000 });

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
    console.log('Starting deep scan phase with reused browser...');
    agent.backgroundJobs.scan.status = 'deep_scanning';
    
    // Pass the browser instance to deep scan to reuse it
    await performDeepScan(agent, browser);
    
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

// Perform deep scan on collected jobs using shared browser
export async function performDeepScan(agent, browser) {
  try {
    // Get jobs that need deep scanning
    const jobIndex = await agent.env.JOB_STORAGE.get('job_index', 'json');
    if (!jobIndex || !jobIndex.jobs) {
      console.log('No jobs found for deep scanning');
      return;
    }

    const jobsToScan = jobIndex.jobs.filter(job => !job.scanned);
    console.log(`Found ${jobsToScan.length} jobs to deep scan`);
    
    if (jobsToScan.length === 0) {
      return;
    }

    // Get plan for profile and scan prompt
    const plan = await agent.env.JOB_STORAGE.get('plan', 'json');
    if (!plan || !plan.profile) {
      console.log('No profile found in plan for deep scanning');
      return;
    }

    // Limit deep scan to avoid timeouts (max 10 jobs)
    const limitedJobs = jobsToScan.slice(0, 10);
    console.log(`Deep scanning ${limitedJobs.length} jobs using shared browser...`);
    
    // Initialize progress tracking
    agent.backgroundJobs.scan.deepScanProgress = {
      total: limitedJobs.length,
      completed: 0,
      current: null,
      errors: 0
    };

    // Create a new page for deep scanning (reusing the browser)
    const deepScanPage = await browser.newPage();
    
    try {
      for (let i = 0; i < limitedJobs.length; i++) {
        const job = limitedJobs[i];
        
        // Check for cancellation before each job
        if (agent.backgroundJobs.scan.cancelled) {
          console.log('Deep scan cancelled by user');
          agent.backgroundJobs.scan.status = 'cancelled';
          break;
        }
        
        // Update progress tracking
        agent.backgroundJobs.scan.deepScanProgress.current = {
          index: i + 1,
          title: job.title,
          company: job.company,
          url: job.url
        };
        
        try {
          console.log(`Deep scanning job ${i + 1}/${limitedJobs.length}: ${job.title} at ${job.company}`);
          
          const scanResult = await performSingleJobDeepScan(agent, deepScanPage, job, plan.profile, plan.scanPrompt || '');
          
          // Update job with scan results
          job.scanned = true;
          job.scanDate = new Date().toISOString();
          job.matchScore = scanResult.matchScore || 0;
          job.matchReason = scanResult.matchReason || '';
          job.description = scanResult.description || job.description;
          job.requirements = scanResult.requirements || [];
          job.salary = scanResult.salary || null;
          job.scanStatus = 'completed';
          
          agent.backgroundJobs.scan.deepScanProgress.completed++;
          console.log(`✓ Job scan complete. Match score: ${job.matchScore}`);
          
        } catch (jobError) {
          console.error(`✗ Error scanning job ${job.id} (${job.title}):`, jobError.message);
          
          // Check if error was due to cancellation
          if (jobError.message.includes('cancelled')) {
            console.log('Deep scan cancelled during job processing');
            agent.backgroundJobs.scan.status = 'cancelled';
            break;
          }
          
          // Mark job as scanned but with error details
          job.scanned = true;
          job.scanDate = new Date().toISOString();
          job.matchScore = 0;
          job.matchReason = 'Scan failed due to error';
          job.scanStatus = 'error';
          job.scanError = {
            type: jobError.name || 'Error',
            message: jobError.message,
            timestamp: new Date().toISOString()
          };
          
          // Log specific error types for debugging
          if (jobError.name === 'TimeoutError') {
            console.log(`  → Timeout accessing job page (likely expired or restricted)`);
            job.scanError.reason = 'page_timeout';
          } else if (jobError.message.includes('parsing')) {
            console.log(`  → AI response parsing failed`);
            job.scanError.reason = 'ai_parsing_error';
          } else {
            job.scanError.reason = 'unknown';
          }
          
          agent.backgroundJobs.scan.deepScanProgress.errors++;
          console.log(`  → Continuing with next job...`);
        }
      }
    } finally {
      // Close the deep scan page when done
      try {
        await deepScanPage.close();
        console.log('Deep scan page closed');
      } catch (pageCloseError) {
        console.error('Error closing deep scan page:', pageCloseError.message);
      }
    }

    // Save updated job index with scan statistics
    const completedJobs = limitedJobs.filter(j => j.scanStatus === 'completed').length;
    const errorJobs = limitedJobs.filter(j => j.scanStatus === 'error').length;
    
    await agent.env.JOB_STORAGE.put('job_index', JSON.stringify(jobIndex));
    
    console.log(`Deep scan phase completed:`);
    console.log(`  ✓ Successfully scanned: ${completedJobs} jobs`);
    console.log(`  ✗ Failed to scan: ${errorJobs} jobs`);
    
    if (errorJobs > 0) {
      const errorTypes = {};
      limitedJobs.filter(j => j.scanStatus === 'error').forEach(job => {
        const reason = job.scanError?.reason || 'unknown';
        errorTypes[reason] = (errorTypes[reason] || 0) + 1;
      });
      console.log(`  Error breakdown:`, errorTypes);
    }
    
  } catch (error) {
    console.error('Error in deep scan phase:', error);
  }
}

// Shared method for deep scanning a single job using provided page (no browser management)
export async function performSingleJobDeepScan(agent, page, job, profile, scanPrompt) {
  console.log(`DEBUG: performSingleJobDeepScan called for ${job.url}`);
  
  try {
    // Check if scan was cancelled before starting
    if (agent.backgroundJobs.scan.cancelled) {
      throw new Error('Scan was cancelled');
    }
    
    console.log(`DEBUG: Setting up timeout promise...`);
    // Add overall timeout wrapper to prevent hanging - increased to 5 minutes for long-running jobs
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        console.log(`DEBUG: Timeout triggered after 5 minutes`);
        reject(new Error('Deep scan operation timed out after 5 minutes'));
      }, 300000); // 5 minutes
    });

    console.log(`DEBUG: Setting up scan promise using provided page...`);
    const scanPromise = (async () => {
      console.log(`DEBUG: Using provided page, starting deep scan...`);
      const result = await deepScanSingleJob(agent, page, job, profile, scanPrompt);
      console.log(`DEBUG: Deep scan completed, result ready`);
      return result;
    })();

    console.log(`DEBUG: Starting Promise.race...`);
    const scanResult = await Promise.race([scanPromise, timeoutPromise]);
    console.log(`DEBUG: Promise.race completed, about to return result`);
    return scanResult;
  } catch (error) {
    console.error(`DEBUG: Deep scan error for ${job.url}:`, error.message);
    throw error;
  }
}
