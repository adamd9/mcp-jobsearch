import * as cheerio from 'cheerio';

// HTTP-based deep scan implementation - more efficient than Playwright/Puppeteer
export async function httpDeepScanSingleJob(agent, job, profile, scanPrompt) {
  if (!job.url) {
    throw new Error('Job URL is required for deep scanning');
  }

  console.log(`  → Fetching job URL via HTTP: ${job.url}`);
  const startTime = Date.now();
  
  try {
    // Fetch the job page with browser-like headers
    const response = await fetch(job.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'max-age=0'
      },
      // Add timeout to prevent hanging
      signal: AbortSignal.timeout(30000) // 30 second timeout
    });

    const fetchTime = Date.now() - startTime;
    console.log(`  → HTTP fetch completed in ${fetchTime}ms, status: ${response.status}`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Parse HTML content
    const html = await response.text();
    const $ = cheerio.load(html);
    
    // Extract page content similar to how Playwright does it
    const pageContent = {
      title: $('title').text() || '',
      url: job.url,
      fullContent: extractJobContent($)
    };

    console.log(`  → Extracted ${pageContent.fullContent.length} characters of content via HTTP`);

    // Validate that we got meaningful job content
    if (pageContent.fullContent.length < 500) {
      console.log(`  ⚠️  Warning: Very little content extracted (${pageContent.fullContent.length} chars), may need JavaScript rendering`);
    }

    // Check for job-related content to ensure we got the right page
    const hasJobKeywords = /job|position|role|responsibilities|requirements|qualifications|description/i.test(pageContent.fullContent);
    if (!hasJobKeywords) {
      console.log(`  ⚠️  Warning: No job-related keywords found in content, may be blocked or redirected`);
    }

    // Send full page content to LLM for extraction and matching (reuse existing function)
    const { analyzeJobPageWithLLM } = await import('./deep-scan.js');
    const analysisResult = await analyzeJobPageWithLLM(agent, pageContent, job, profile, scanPrompt);
    
    console.log(`  → HTTP-based deep scan completed for ${job.url}, match score: ${analysisResult.matchScore}`);
    return analysisResult;

  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.log(`  → HTTP fetch failed after ${totalTime}ms: ${error.message}`);
    
    // Log additional error details for debugging
    if (error.name === 'AbortError') {
      console.log(`  → Request timed out after 30 seconds`);
    } else if (error.message.includes('HTTP')) {
      console.log(`  → Server returned error response`);
    } else {
      console.log(`  → Network or parsing error`);
    }
    
    throw error;
  }
}

// Extract meaningful job content from the parsed HTML
function extractJobContent($) {
  // Remove script and style elements
  $('script, style, noscript').remove();
  
  // Try to get the main body text, similar to document.body.innerText
  let fullContent = $('body').text();
  
  // Clean up the text - remove excessive whitespace
  fullContent = fullContent
    .replace(/\s+/g, ' ')  // Replace multiple whitespace with single space
    .replace(/\n\s*\n/g, '\n')  // Remove empty lines
    .trim();
  
  return fullContent;
}

// HTTP-based version of performDeepScan that doesn't need browser management
export async function httpPerformDeepScan(agent) {
  try {
    // Get jobs that need deep scanning
    const jobIndex = await agent.env.JOB_STORAGE.get('job_index', 'json');
    if (!jobIndex || !jobIndex.jobs) {
      console.log('No jobs found for deep scanning');
      return;
    }

    const jobsToScan = jobIndex.jobs.filter(job => !job.scanned);
    console.log(`Found ${jobsToScan.length} jobs to deep scan via HTTP`);
    
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
    console.log(`HTTP deep scanning ${limitedJobs.length} jobs (no browser needed)...`);
    
    // Initialize progress tracking
    agent.backgroundJobs.scan.deepScanProgress = {
      total: limitedJobs.length,
      completed: 0,
      current: null,
      errors: 0
    };

    // Process jobs sequentially using HTTP requests
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
        console.log(`HTTP deep scanning job ${i + 1}/${limitedJobs.length}: ${job.title} at ${job.company}`);
        
        const scanResult = await httpDeepScanSingleJob(agent, job, plan.profile, plan.scanPrompt || '');
        
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
        console.log(`✓ HTTP job scan complete. Match score: ${job.matchScore}`);
        
      } catch (jobError) {
        console.error(`✗ Error in HTTP scan for job ${job.id} (${job.title}):`, jobError.message);
        
        // Check if error was due to cancellation
        if (jobError.message.includes('cancelled')) {
          console.log('HTTP deep scan cancelled during job processing');
          agent.backgroundJobs.scan.status = 'cancelled';
          break;
        }
        
        // Mark job as scanned but with error details
        job.scanned = true;
        job.scanDate = new Date().toISOString();
        job.matchScore = 0;
        job.matchReason = 'HTTP scan failed due to error';
        job.scanStatus = 'error';
        job.scanError = {
          type: jobError.name || 'Error',
          message: jobError.message,
          timestamp: new Date().toISOString()
        };
        
        // Log specific error types for debugging
        if (jobError.name === 'AbortError') {
          console.log(`  → HTTP request timeout (likely slow response)`);
          job.scanError.reason = 'http_timeout';
        } else if (jobError.message.includes('HTTP')) {
          console.log(`  → HTTP error response from server`);
          job.scanError.reason = 'http_error';
        } else {
          job.scanError.reason = 'unknown';
        }
        
        agent.backgroundJobs.scan.deepScanProgress.errors++;
        console.log(`  → Continuing with next job...`);
      }
    }

    // Save updated job index with scan statistics
    const completedJobs = limitedJobs.filter(j => j.scanStatus === 'completed').length;
    const errorJobs = limitedJobs.filter(j => j.scanStatus === 'error').length;
    
    await agent.env.JOB_STORAGE.put('job_index', JSON.stringify(jobIndex));
    
    console.log(`HTTP deep scan phase completed:`);
    console.log(`  ✓ Successfully scanned: ${completedJobs} jobs`);
    console.log(`  ✗ Failed to scan: ${errorJobs} jobs`);
    console.log(`  📊 Total processing time saved by avoiding browser overhead`);
    
  } catch (error) {
    console.error('HTTP deep scan failed:', error.message);
    throw error;
  }
}
