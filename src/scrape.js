import fs from 'fs/promises';
import path from 'path';
import { updateJobIndex, generateJobId, getJobsToScan, hasProfileChanged } from './storage.js';
import { deepScanJobs } from './deep-scan.js';
import { loadConfig } from './config.js';
import { createAuditLogger } from './audit-logger.js';
import { scrapeLinkedInJobs, extractCompanyFromTitle } from './scrapers/linkedin.js';

export async function scrapeLinkedIn(url, options = {}, checkCancellation = null) {
  const { 
    keepOpen = false, 
    debug = false, 
    deepScan = false, 
    forceRescan = false, 
    profileText = null, 
    scanPrompt = '', 
    progressCallback = null 
  } = options;
  
  // Load configuration
  const config = await loadConfig();
  
  // Initialize audit logger
  const auditLogger = await createAuditLogger(config);
  
  // Check for cancellation before starting
  if (checkCancellation && checkCancellation()) {
    console.log('Cancellation requested before starting LinkedIn scraping');
    return { jobs: [], cancelled: true };
  }
  
  // Set up pagination options
  const paginationOptions = {
    maxPages: config.paginationEnabled ? config.paginationMaxPages : 1,
    resultsPerPage: config.paginationResultsPerPage
  };
  
  console.log(`Pagination config: enabled=${config.paginationEnabled}, maxPages=${paginationOptions.maxPages}, resultsPerPage=${paginationOptions.resultsPerPage}`);
  
  // Create a progress callback wrapper that includes pagination info
  const paginationProgressCallback = (paginationInfo) => {
    if (typeof progressCallback === 'function') {
      progressCallback({
        ...paginationInfo,
        stage: 'scraping'
      });
    }
  };
  
  // Scrape LinkedIn jobs with pagination support
  const { jobs } = await scrapeLinkedInJobs({
    url,
    keepOpen,
    debug,
    maxPages: paginationOptions.maxPages,
    resultsPerPage: paginationOptions.resultsPerPage,
    progressCallback: paginationProgressCallback,
    checkCancellation
  });
  
  // Process the jobs and update the job index
  console.log(`Found ${jobs.length} job listings across all pages`);
  
  // Enhance jobs with IDs and additional metadata
  const enhancedJobs = jobs.map(job => ({
    ...job,
    id: generateJobId(job.link),
    company: job.company || extractCompanyFromTitle(job.title),
    scrapedDate: new Date().toISOString(),
    searchUrl: url  // Add the search URL to each job
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
        // No need to close browser here as we're not using one in this context
        
        // Deep scan the jobs
        const concurrency = parseInt(process.env.DEEP_SCAN_CONCURRENCY || '2');
        
        // Create job details capture callback
        const jobDetailsCallback = async (jobId, jobDetails) => {
          // Log job details to audit log
          await auditLogger.logJobDetails(jobId, jobDetails);
          
          // Call progress callback if provided
          if (typeof progressCallback === 'function') {
            progressCallback(jobId, jobDetails);
          }
        };
        
        // Pass audit logger to deep scan
        await deepScanJobs(jobsToScan, profile, concurrency, scanPrompt, jobDetailsCallback, auditLogger);
        
        console.log('Deep scanning complete');
        
        // Generate mock data if audit logging is enabled
        if (config.auditLogging) {
          console.log('Generating mock data from audit logs...');
          const mockDataResult = await auditLogger.generateMockData();
          console.log(`Mock data generation complete: ${JSON.stringify(mockDataResult)}`);
        }
      } else {
        console.log('No jobs need deep scanning');
      }
    } catch (error) {
      console.error(`Error during deep scanning: ${error.message}`);
    }
  }
  
  // Return the enhanced jobs
  return { jobs: enhancedJobs };
}

/**
 * Scrape multiple LinkedIn search URLs (for different search terms and locations)
 * @param {Array} searchUrls - Array of search URL objects
 * @param {Object} options - Scraping options
 * @param {Function} checkCancellation - Optional function to check if scraping should be cancelled
 * @returns {Promise<Object>} - Scraping results
 */
export async function scrapeMultipleSearches(searchUrls, options = {}, checkCancellation = null) {
  const { deepScan = false, forceRescan = false, profileText = null, scanPrompt = '', progressCallback = null } = options;
  
  // Load configuration
  const config = await loadConfig();
  
  // Initialize audit logger
  const auditLogger = await createAuditLogger(config);
  
  let allJobs = [];
  
  // Loop through each search URL
  for (let i = 0; i < searchUrls.length; i++) {
    // Check for cancellation request
    if (checkCancellation && checkCancellation()) {
      console.log('Cancellation requested. Stopping scraping process.');
      return { jobs: allJobs, cancelled: true };
    }
    const searchUrlObj = searchUrls[i];
    const { url, term, location } = searchUrlObj;
    
    console.log(`\nProcessing search ${i + 1}/${searchUrls.length}: Term="${term}", Location="${location}"`);
    
    // Create a progress callback wrapper that includes search info
    const searchProgressCallback = (info) => {
      if (typeof progressCallback === 'function') {
        progressCallback({
          ...info,
          currentSearch: i + 1,
          totalSearches: searchUrls.length,
          searchTerm: term,
          searchLocation: location
        });
      }
    };
    
    // Scrape LinkedIn jobs
    const jobs = await linkedinScraper.scrapeLinkedInJobs(url, {
      checkCancellation,
      ...options,
      deepScan: false, // We'll do deep scan after all searches
      progressCallback: searchProgressCallback
    });
    
    // Add location metadata to jobs
    const jobsWithLocation = jobs.map(job => ({
      ...job,
      searchTerm: term,
      searchLocation: location
    }));
    
    // Add jobs from this search to the overall collection
    allJobs = [...allJobs, ...jobsWithLocation];
    
    // Wait a bit between searches to avoid rate limiting
    if (i < searchUrls.length - 1) {
      console.log('Waiting between searches...');
      // Check for cancellation during wait
      if (checkCancellation) {
        // Wait with cancellation check
        const waitTimeMs = 3000;
        const checkIntervalMs = 500;
        const startTime = Date.now();
        
        while (Date.now() - startTime < waitTimeMs) {
          if (checkCancellation()) {
            console.log('Cancellation requested during wait. Stopping scraping process.');
            return { jobs: allJobs, cancelled: true };
          }
          await new Promise(resolve => setTimeout(resolve, Math.min(checkIntervalMs, waitTimeMs - (Date.now() - startTime))));
        }
      } else {
        // Regular wait
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  }
  
  console.log(`\nCompleted all searches. Found ${allJobs.length} total jobs.`);
  
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
        // Deep scan the jobs
        const concurrency = config.deepScanConcurrency;
        
        // Create job details capture callback
        const jobDetailsCallback = async (jobId, jobDetails) => {
          // Log job details to audit log
          await auditLogger.logJobDetails(jobId, jobDetails);
          
          // Call progress callback if provided
          if (typeof progressCallback === 'function') {
            progressCallback({
              stage: 'deepScan',
              jobId,
              jobDetails
            });
          }
        };
        
        // Pass audit logger to deep scan
        await deepScanJobs(jobsToScan, profile, concurrency, scanPrompt, jobDetailsCallback, auditLogger);
        
        console.log('Deep scanning complete');
        
        // Generate mock data if audit logging is enabled
        if (config.auditLogging) {
          console.log('Generating mock data from audit logs...');
          const mockDataResult = await auditLogger.generateMockData();
          console.log(`Mock data generation complete: ${JSON.stringify(mockDataResult)}`);
        }
      } else {
        console.log('No jobs need deep scanning');
      }
    } catch (error) {
      console.error(`Error during deep scanning: ${error.message}`);
    }
  }
  
  return { jobs: allJobs };
}
