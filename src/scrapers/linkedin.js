/**
 * LinkedIn-specific scraping implementation
 */
import { chromium } from "playwright";
import { loadConfig } from '../config.js';
import { createAuditLogger } from '../audit-logger.js';

/**
 * Extract search term from LinkedIn URL
 * @param {string} url - LinkedIn search URL
 * @returns {string} - Extracted search term or 'unknown'
 */
export function extractSearchTermFromUrl(url) {
  if (!url) return 'unknown';
  
  try {
    const urlObj = new URL(url);
    
    // Extract keywords parameter
    if (urlObj.searchParams.has('keywords')) {
      return decodeURIComponent(urlObj.searchParams.get('keywords'));
    }
    
    // Try to extract from path segments
    const pathSegments = urlObj.pathname.split('/');
    for (let i = 0; i < pathSegments.length; i++) {
      if (pathSegments[i] === 'search' && i + 1 < pathSegments.length) {
        return pathSegments[i + 1].replace(/-/g, ' ');
      }
    }
    
    return 'unknown';
  } catch (error) {
    console.error(`Error extracting search term from URL: ${error.message}`);
    return 'unknown';
  }
}

/**
 * Extract company name from job title if possible
 * @param {string} title - Job title
 * @returns {string|null} - Company name or null
 */
export function extractCompanyFromTitle(title) {
  if (!title) return null;
  
  // Look for "at Company" pattern
  const atMatch = title.match(/\bat\s+([^\s]+(?:\s+[^\s]+){0,3})$/i);
  if (atMatch) {
    return atMatch[1].trim();
  }
  
  return null;
}

/**
 * Generate a paginated LinkedIn search URL
 * @param {string} baseUrl - Base LinkedIn search URL
 * @param {number} page - Page number (0-based)
 * @param {number} resultsPerPage - Results per page
 * @returns {string} - Paginated URL
 */
export function generatePaginatedUrl(baseUrl, page, resultsPerPage) {
  const url = new URL(baseUrl);
  const start = page * resultsPerPage;
  url.searchParams.set('start', start.toString());
  return url.toString();
}

/**
 * Scrape LinkedIn jobs from a search URL with pagination support
 * @param {Object} options - Scraping options
 * @param {Function} checkCancellation - Optional function to check if scraping should be cancelled
 * @returns {Promise<Object>} - Scraping results
 */
export async function scrapeLinkedInJobs(options) {
  const { 
    url, 
    keepOpen = false, 
    debug = false, 
    maxPages = 1,
    resultsPerPage = 25,
    progressCallback = null,
    checkCancellation = null
  } = options;
  
  console.log(`Starting LinkedIn scrape for URL: ${url}`);
  console.log(`Debug mode: ${debug ? 'ON' : 'OFF'}, Keep browser open: ${keepOpen ? 'YES' : 'NO'}`);
  console.log(`Pagination: Max pages = ${maxPages}, Results per page = ${resultsPerPage}`);
  
  // Load configuration
  const config = await loadConfig();
  
  // Initialize audit logger
  const auditLogger = await createAuditLogger(config);
  
  // Extract search term from URL
  const searchTerm = extractSearchTermFromUrl(url);
  
  // Check for cancellation before launching browser
  if (checkCancellation && checkCancellation()) {
    console.log('Cancellation requested before launching browser');
    return { jobs: [], cancelled: true };
  }
  
  // Set headless to false for debugging to see the browser
  const browser = await chromium.launch({ 
    headless: !debug, // Only show browser in debug mode
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
  
  // Initialize array to store all jobs across all pages
  let allJobs = [];
  let currentPage = 0;
  let hasMorePages = true;
  
  // Selectors for job listings
  const selectors = [
    // Modern LinkedIn selectors
    ".jobs-search-results__list-item",
    ".job-search-card", 
    // Older selectors
    "ul.jobs-search-results__list li",
    ".jobs-search-results-list__list-item",
    ".jobs-search__results-list li"
  ];
  
  // Loop through pages for pagination
  while (hasMorePages && currentPage < maxPages) {
    // Check for cancellation before processing each page
    if (checkCancellation && checkCancellation()) {
      console.log('Cancellation requested before processing page', currentPage + 1);
      await browser.close();
      return { jobs: allJobs, cancelled: true };
    }
    // Generate paginated URL for current page
    const paginatedUrl = currentPage === 0 ? url : generatePaginatedUrl(url, currentPage, resultsPerPage);
    
    console.log(`Navigating to job search URL (page ${currentPage + 1}): ${paginatedUrl}`);
    try {
      // Use a shorter timeout and don't wait for networkidle which can be problematic
      await page.goto(paginatedUrl, { timeout: 60000, waitUntil: "domcontentloaded" });
      
      // Wait for job cards to load
      try {
        // Check for cancellation before waiting for job cards
        if (checkCancellation && checkCancellation()) {
          console.log('Cancellation requested while waiting for job cards');
          await browser.close();
          return { jobs: allJobs, cancelled: true };
        }
        
        // Wait for the job listings to be visible with a more generous timeout
        console.log('Waiting for job listings to load...');
        await page.waitForSelector('.jobs-search-results-list, .jobs-search__results-list', { timeout: 10000 })
          .catch(() => console.log('Could not find job listings container, continuing anyway...'));
        
        // Take screenshot after basic content is loaded
        console.log(`Taking screenshot for page ${currentPage + 1}...`);
        const screenshotBuffer = await page.screenshot();
        
        // Log screenshot to audit log
        await auditLogger.logScreenshot(`search-${searchTerm.replace(/\s+/g, '-')}-page${currentPage + 1}`, screenshotBuffer);
        
        // Wait between pages to avoid rate limiting
        if (currentPage < maxPages - 1 && hasMorePages) {
          console.log(`Waiting before loading next page...`);
          
          // Wait with cancellation check
          if (checkCancellation) {
            const waitTimeMs = 2000;
            const checkIntervalMs = 500;
            const startTime = Date.now();
            
            let cancelled = false;
            while (Date.now() - startTime < waitTimeMs && !cancelled) {
              if (checkCancellation()) {
                console.log('Cancellation requested during wait between pages');
                cancelled = true;
                await browser.close();
                return { jobs: allJobs, cancelled: true };
              }
              await new Promise(resolve => setTimeout(resolve, Math.min(checkIntervalMs, waitTimeMs - (Date.now() - startTime))));
            }
          } else {
            // Regular wait
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      } catch (error) {
        console.log(`Navigation error: ${error.message}`);
        // Take screenshot even if there was an error
        console.log('Taking screenshot after error...');
        await page.screenshot({ path: `debug-linkedin-error-page${currentPage + 1}.png` });
        break; // Exit the pagination loop on error
      }
      
      console.log(`Extracting job listings from page ${currentPage + 1}...`);
      
      let pageJobs = [];
      let foundSelector = false;
      
      // Try different selectors that LinkedIn might be using
      for (const selector of selectors) {
      console.log(`Trying selector: ${selector}`);
      const elements = await page.$$(selector);
      console.log(`Found ${elements.length} elements with selector ${selector}`);
      
      if (elements.length > 0) {
        try {
          pageJobs = await page.$$eval(selector, els =>
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
          foundSelector = true;
          break;
        } catch (error) {
          console.log(`Error extracting data with selector ${selector}: ${error.message}`);
        }
      }
    }
    
    // Process the jobs from this page
    console.log(`Found ${pageJobs.length} job listings on page ${currentPage + 1}`);
    
    // Add jobs from this page to the overall collection
    allJobs = [...allJobs, ...pageJobs];
    
    // Check if we should continue to the next page
    hasMorePages = pageJobs.length > 0 && foundSelector;
    
    // Call progress callback if provided
    if (typeof progressCallback === 'function') {
      progressCallback({
        currentPage: currentPage + 1,
        maxPages,
        jobsFound: pageJobs.length,
        totalJobsFound: allJobs.length
      });
    }
    
    // Move to the next page
    currentPage++;
    } catch (outerError) {
      console.error(`Error processing page ${currentPage}: ${outerError.message}`);
      // Take screenshot if possible
      try {
        await page.screenshot({ path: `error-page-${currentPage}.png` });
      } catch (e) {
        console.error('Could not take error screenshot:', e.message);
      }
    }
  }
  
  console.log(`Pagination complete. Scraped ${currentPage} pages with ${allJobs.length} total jobs.`);
  
  // Log search results to audit log
  await auditLogger.logSearchResults(searchTerm, allJobs);
  
  if (keepOpen) {
    console.log('\nKeeping browser open for manual inspection. Close the browser window when done.');
    return { jobs: allJobs, browser };
  } else {
    await browser.close();
    return { jobs: allJobs };
  }
}
