import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import OpenAI from "openai";
import { launch } from "@cloudflare/playwright";
import { getPlanTool, createPlanTool, updatePlanTool } from "./plan.js";
import { getScanTool, getRescanTool } from "./scan.js";

// Define our MCP agent with tools

export class JobSearchMCP extends McpAgent {
  constructor(state, env) {
    super(state, env);
    this.backgroundJobs = {
      scan: { inProgress: false, status: 'idle', error: null },
    };
  }

  server = new McpServer({
    name: "JobSearch MCP",
    version: "1.0.0",
  });

  openai = null;

  async init() {
    this.openai = new OpenAI({
      apiKey: this.env.OPENAI_API_KEY,
    });

    // Status tool
    this.server.tool(
      "status",
      "Check the status of a background job, such as a scan.",
      {},
      async () => {
        return {
          content: [{ type: "text", text: JSON.stringify(this.backgroundJobs.scan, null, 2) }],
          structuredContent: this.backgroundJobs.scan
        };
      },
      {
        title: "Get Job Status",
        readOnlyHint: true
      }
    );

    // Plan tools (from plan.js)
    const planTools = [
      getPlanTool(this.env),
      createPlanTool(this.env, this.openai),
      updatePlanTool(this.env, this.openai),
    ];
    for (const tool of planTools) {
      if (tool.args) {
        this.server.tool(
          tool.name,
          tool.description,
          tool.args,
          tool.handler,
          tool.options
        );
      } else {
        this.server.tool(
          tool.name,
          tool.description,
          tool.handler,
          tool.options
        );
      }
    }

    // Scan & Rescan tools (from scan.js)
    const scanTool = getScanTool(this);
    this.server.tool(scanTool.name, scanTool.description, scanTool.args, scanTool.handler, scanTool.options);

    const rescanTool = getRescanTool(this);
    this.server.tool(rescanTool.name, rescanTool.description, rescanTool.args, rescanTool.handler, rescanTool.options);

    // Manual deep scan tool for debugging
    this.server.tool(
      "deep_scan_job",
      "Manually deep scan a specific LinkedIn job URL for testing and debugging",
      {
        url: z.string().url().describe("LinkedIn job URL to deep scan")
      },
      async ({ url }) => {
        try {
          console.log(`Manual deep scan requested for: ${url}`);
          
          // Get plan for profile
          const plan = await this.env.JOB_STORAGE.get('plan', 'json');
          if (!plan || !plan.profile) {
            return {
              content: [{ type: "text", text: "No profile found in plan. Create a plan first." }],
              isError: true
            };
          }

          // Create a mock job object for the URL
          const mockJob = {
            id: this._generateJobId(url),
            url: url,
            title: 'Manual Deep Scan',
            company: 'Unknown',
            location: 'Unknown'
          };

          // Use the shared deep scan logic
          const scanResult = await this._performSingleJobDeepScan(mockJob, plan.profile, plan.scanPrompt || '');
            
          return {
            content: [{ 
              type: "text", 
              text: `Deep scan completed for ${url}\n\nMatch Score: ${scanResult.matchScore}\nMatch Reason: ${scanResult.matchReason}\n\nJob Details:\nTitle: ${scanResult.title}\nCompany: ${scanResult.company}\nLocation: ${scanResult.location}\n\nDescription: ${scanResult.description?.substring(0, 500)}...` 
            }],
            structuredContent: {
              url,
              scanResult,
              success: true
            }
          };
        } catch (error) {
          console.error('Manual deep scan error:', error);
          return {
            content: [{ 
              type: "text", 
              text: `Deep scan failed for ${url}\n\nError: ${error.message}\nError Type: ${error.name}` 
            }],
            structuredContent: {
              url,
              error: error.message,
              errorType: error.name,
              success: false
            },
            isError: true
          };
        }
      },
      {
        title: "Manual Deep Scan Job",
        readOnlyHint: false,
        openWorldHint: true
      }
    );

    // Failed jobs report tool
    this.server.tool(
      "failed_jobs",
      "Get a report of jobs that failed during deep scanning for manual verification",
      {
        errorType: z.string().optional().describe("Filter by error type: 'page_timeout', 'ai_parsing_error', 'unknown', or leave empty for all")
      },
      async ({ errorType }) => {
        try {
          const jobIndex = await this.env.JOB_STORAGE.get('job_index', 'json');
          if (!jobIndex || !jobIndex.jobs) {
            return {
              content: [{ type: "text", text: "No job index found. Run a scan first." }],
              isError: true
            };
          }

          // Filter failed jobs
          let failedJobs = jobIndex.jobs.filter(job => job.scanStatus === 'error');
          
          if (errorType) {
            failedJobs = failedJobs.filter(job => job.scanError?.reason === errorType);
          }

          if (failedJobs.length === 0) {
            const filterText = errorType ? ` with error type '${errorType}'` : '';
            return {
              content: [{ type: "text", text: `No failed jobs found${filterText}.` }]
            };
          }

          // Group by error type for summary
          const errorSummary = {};
          failedJobs.forEach(job => {
            const reason = job.scanError?.reason || 'unknown';
            errorSummary[reason] = (errorSummary[reason] || 0) + 1;
          });

          // Create detailed report
          let report = `Failed Jobs Report (${failedJobs.length} total)\n`;
          report += `Error breakdown: ${JSON.stringify(errorSummary)}\n\n`;
          
          failedJobs.forEach((job, index) => {
            report += `${index + 1}. ${job.title} at ${job.company}\n`;
            report += `   URL: ${job.url}\n`;
            report += `   Error: ${job.scanError?.type || 'Unknown'} - ${job.scanError?.message || 'No message'}\n`;
            report += `   Reason: ${job.scanError?.reason || 'unknown'}\n`;
            report += `   Failed at: ${job.scanError?.timestamp || job.scanDate}\n`;
            report += `   Job ID: ${job.id}\n\n`;
          });

          // Add instructions for manual verification
          report += "\n--- Manual Verification Instructions ---\n";
          report += "1. Copy any job URL above and paste it in your browser\n";
          report += "2. If the page loads normally, the job is still active (possible scraping issue)\n";
          report += "3. If you get 'Job not found' or redirect to LinkedIn homepage, the job expired\n";
          report += "4. Use the 'deep_scan_job' tool to test specific URLs that should work\n";

          return {
            content: [{ type: "text", text: report }],
            structuredContent: {
              totalFailed: failedJobs.length,
              errorSummary,
              failedJobs: failedJobs.map(job => ({
                id: job.id,
                title: job.title,
                company: job.company,
                url: job.url,
                errorType: job.scanError?.type,
                errorReason: job.scanError?.reason,
                errorMessage: job.scanError?.message,
                timestamp: job.scanError?.timestamp
              }))
            }
          };
        } catch (error) {
          console.error('Error generating failed jobs report:', error);
          return {
            content: [{ type: "text", text: `Error generating report: ${error.message}` }],
            isError: true
          };
        }
      },
      {
        title: "Failed Jobs Report",
        readOnlyHint: true,
        openWorldHint: false
      }
    );

    // Removed duplicate inline scan block

        // Job Indexing and Digests
    this.server.tool(
      "reset_job_index",
      "Reset the job index to start fresh - removes all stored jobs",
      {},
      async () => {
        try {
          // Get current job index to see what we're resetting
          const currentIndex = await this.env.JOB_STORAGE.get('job_index', 'json');
          const jobCount = currentIndex?.jobs?.length || 0;
          
          // Reset the job index to empty state
          const resetIndex = {
            jobs: [],
            lastUpdate: new Date().toISOString(),
            lastScanDate: null,
            profileHash: null
          };
          
          await this.env.JOB_STORAGE.put('job_index', JSON.stringify(resetIndex));
          
          console.log(`Job index reset: removed ${jobCount} jobs`);
          
          return {
            content: [{ 
              type: "text", 
              text: `Job index has been reset successfully. Removed ${jobCount} jobs from storage.` 
            }],
            structuredContent: { 
              success: true,
              removedJobs: jobCount,
              resetTime: resetIndex.lastUpdate
            },
          };
        } catch (error) {
          console.error('Error resetting job index:', error);
          return {
            content: [{ 
              type: "text", 
              text: `Error resetting job index: ${error.message}` 
            }],
            structuredContent: { 
              success: false,
              error: error.message
            },
            isError: true
          };
        }
      },
      {
        title: "Reset Job Index",
        readOnlyHint: false,
        openWorldHint: false
      }
    );

    this.server.tool(
      "send_digest",
      "Send digest email with job matches to the specified email address",
      {
        email: z.string().describe("Email address to send digest to")
      },
      async ({ email }) => {
        // Stub implementation
        return {
          content: [{ type: "text", text: `Sent digest email to ${email} with 5 job matches` }],
          structuredContent: { sent: 5, email },
        };
      },
      {
        title: "Send Job Digest Email",
        readOnlyHint: false,
        openWorldHint: false
      }
    );
  }

  async _runScan(url) {
    try {
      let urlsToProcess = [];
      console.log('--- _runScan invoked ---');
if (url) {
        urlsToProcess.push({ url }); // Match the structure of plan.searchUrls
      } else {
        const plan = await this.env.JOB_STORAGE.get('plan', 'json');
        if (!plan || !plan.searchUrls || plan.searchUrls.length === 0) {
          throw new Error('No URL provided and no searches found in the current plan.');
        }
        urlsToProcess = plan.searchUrls;
  console.log('URLs to scan:', urlsToProcess.map(u => u.url));
  console.log(`Loaded plan with ${plan.searchUrls.length} search URLs`);
      }

      this.backgroundJobs.scan.status = 'running';
      this.backgroundJobs.scan.urlsToScan = urlsToProcess.map(u => u.url);

      const browser = await launch(this.env.BROWSER);
      const page = await browser.newPage();

      // Login once at the beginning of the scan.
      console.log('Navigating to LinkedIn login page...');
      await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });

      console.log('Entering login credentials...');
      await page.type('#username', this.env.LINKEDIN_EMAIL);
      await page.type('#password', this.env.LINKEDIN_PASSWORD);

      console.log('Submitting login form...');
      await page.click('button[type="submit"]');

      console.log('Waiting for login to complete...');
      await page.waitForNavigation({ waitUntil: 'networkidle' }).catch(e => console.log('Navigation timeout after login, continuing...'));

      // Check for security verification right after login attempt
      const postLoginUrl = page.url();
      if (postLoginUrl.includes('checkpoint') || postLoginUrl.includes('security-verification')) {
        console.log(`LinkedIn security check detected at ${postLoginUrl}. The scraper may fail.`);
        this.backgroundJobs.scan.error = 'LinkedIn security check detected. Manual login in a browser may be required.';
        // It's probably not useful to continue if we hit a checkpoint.
        throw new Error(this.backgroundJobs.scan.error);
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
          this.backgroundJobs.scan.totalJobsFound += jobs.length;

          // Store jobs for deep scanning
          if (jobs.length > 0) {
            const jobsWithId = jobs.map(job => ({
              ...job,
              id: this._generateJobId(job.url),
              searchUrl: scanUrl.url,
              scanned: false,
              scanDate: null,
              matchScore: null
            }));
            
            // Store jobs in KV for later deep scan
            await this._storeJobsForDeepScan(jobsWithId);
          }

        } catch (selectorError) {
            console.log(`Could not find job list using the new selectors: ${selectorError.message}`);
            this.backgroundJobs.scan.error = `Failed to find job list on page. The layout may have changed.`;
        }

        this.backgroundJobs.scan.scannedUrls.push(scanUrl.url);
        console.log('Continuing to next step after trying to scrape...');
      }

      // After all search URLs are processed, start deep scan phase
      console.log('Starting deep scan phase...');
      this.backgroundJobs.scan.status = 'deep_scanning';
      
      await this._performDeepScan();
      
      // Set status to completed before closing the browser to ensure state is updated.
      this.backgroundJobs.scan.status = 'completed';
      await browser.close();
    } catch (e) {
      console.error('Error during scan:', e);
      this.backgroundJobs.scan.status = 'error';
      this.backgroundJobs.scan.error = e.message;
    } finally {
      this.backgroundJobs.scan.inProgress = false;
      this.backgroundJobs.scan.endTime = new Date().toISOString();
    }
  }

  // Generate a unique job ID from URL
  _generateJobId(jobUrl) {
    if (!jobUrl) return null;
    // Extract job ID from LinkedIn URL (e.g., /view/123456/)
    const match = jobUrl.match(/\/view\/(\d+)\//); 
    return match ? match[1] : jobUrl.split('/').pop().split('?')[0];
  }

  // Store jobs for later deep scanning
  async _storeJobsForDeepScan(jobs) {
    try {
      // Get existing job index
      const existingJobs = await this.env.JOB_STORAGE.get('job_index', 'json') || { jobs: [] };
      
      // Add new jobs, avoiding duplicates
      const existingIds = new Set(existingJobs.jobs.map(j => j.id));
      const newJobs = jobs.filter(job => job.id && !existingIds.has(job.id));
      
      if (newJobs.length > 0) {
        existingJobs.jobs.push(...newJobs);
        existingJobs.lastUpdate = new Date().toISOString();
        
        await this.env.JOB_STORAGE.put('job_index', JSON.stringify(existingJobs));
        console.log(`Stored ${newJobs.length} new jobs for deep scanning`);
      }
    } catch (error) {
      console.error('Error storing jobs for deep scan:', error);
    }
  }

  // Perform deep scan on collected jobs
  async _performDeepScan() {
    try {
      // Get jobs that need deep scanning
      const jobIndex = await this.env.JOB_STORAGE.get('job_index', 'json');
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
      const plan = await this.env.JOB_STORAGE.get('plan', 'json');
      if (!plan || !plan.profile) {
        console.log('No profile found in plan for deep scanning');
        return;
      }

      // Limit deep scan to avoid timeouts (max 10 jobs)
      const limitedJobs = jobsToScan.slice(0, 10);
      console.log(`Deep scanning ${limitedJobs.length} jobs...`);

      for (const job of limitedJobs) {
        try {
          console.log(`Deep scanning job: ${job.title} at ${job.company}`);
          
          const scanResult = await this._performSingleJobDeepScan(job, plan.profile, plan.scanPrompt || '');
          
          // Update job with scan results
          job.scanned = true;
          job.scanDate = new Date().toISOString();
          job.matchScore = scanResult.matchScore || 0;
          job.matchReason = scanResult.matchReason || '';
          job.description = scanResult.description || job.description;
          job.requirements = scanResult.requirements || [];
          job.salary = scanResult.salary || null;
          job.scanStatus = 'completed';
          
          console.log(`✓ Job scan complete. Match score: ${job.matchScore}`);
          
        } catch (jobError) {
          console.error(`✗ Error scanning job ${job.id} (${job.title}):`, jobError.message);
          
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
          
          console.log(`  → Continuing with next job...`);
        }
      }

      // Save updated job index with scan statistics
      const completedJobs = limitedJobs.filter(j => j.scanStatus === 'completed').length;
      const errorJobs = limitedJobs.filter(j => j.scanStatus === 'error').length;
      
      await this.env.JOB_STORAGE.put('job_index', JSON.stringify(jobIndex));
      
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

  // Shared method for deep scanning a single job (handles browser management)
  async _performSingleJobDeepScan(job, profile, scanPrompt) {
    const browser = await launch(this.env.BROWSER);
    const page = await browser.newPage();

    try {
      const scanResult = await this._deepScanSingleJob(page, job, profile, scanPrompt);
      await browser.close();
      return scanResult;
    } catch (error) {
      await browser.close();
      throw error;
    }
  }

  // Deep scan a single job
  async _deepScanSingleJob(page, job, profile, scanPrompt) {
    if (!job.url) {
      throw new Error('Job URL is required for deep scanning');
    }

    console.log(`  → Navigating to job URL: ${job.url}`);
    const startTime = Date.now();
    
    try {
      // Try with longer timeout and wait for JavaScript to settle
      await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      
      // Wait for LinkedIn's dynamic content to load
      await page.waitForTimeout(3000);
      
      const loadTime = Date.now() - startTime;
      console.log(`  → Page loaded in ${loadTime}ms`);
    } catch (navError) {
      const loadTime = Date.now() - startTime;
      console.log(`  → Page failed to load after ${loadTime}ms`);
      
      // Try one more time with networkidle strategy
      try {
        console.log(`  → Retrying with networkidle strategy...`);
        await page.goto(job.url, { waitUntil: 'networkidle', timeout: 15000 });
        const retryTime = Date.now() - startTime;
        console.log(`  → Page loaded on retry in ${retryTime}ms`);
      } catch (retryError) {
        const finalTime = Date.now() - startTime;
        console.log(`  → Final attempt failed after ${finalTime}ms`);
        
        // Log DOM snapshot for debugging
        try {
          const currentUrl = page.url();
          const pageTitle = await page.title().catch(() => 'Unable to get title');
          const bodyText = await page.evaluate(() => {
            return document.body ? document.body.innerText.substring(0, 500) : 'No body content';
          }).catch(() => 'Unable to get body text');
          
          console.log(`  → DOM Snapshot for failed job ${job.id}:`);
          console.log(`     Current URL: ${currentUrl}`);
          console.log(`     Page Title: ${pageTitle}`);
          console.log(`     Body Text (first 500 chars): ${bodyText}`);
          
          // Check for common LinkedIn error indicators
          const hasLoginForm = await page.$('form[data-id="sign-in-form"]').catch(() => null);
          const hasErrorMessage = await page.$('.error-message, .not-found').catch(() => null);
          const hasJobContent = await page.$('.jobs-unified-top-card, .job-details').catch(() => null);
          
          console.log(`     Has Login Form: ${!!hasLoginForm}`);
          console.log(`     Has Error Message: ${!!hasErrorMessage}`);
          console.log(`     Has Job Content: ${!!hasJobContent}`);
          
        } catch (snapshotError) {
          console.log(`  → Failed to capture DOM snapshot: ${snapshotError.message}`);
        }
        
        throw navError; // Throw original error
      }
    }

    // Extract full page content for LLM analysis
    console.log(`  → Extracting full page content...`);
    const pageContent = await page.evaluate(() => {
      // Get the page title
      const title = document.title;
      
      // Get all visible text content, cleaned up
      const bodyText = document.body ? document.body.innerText : '';
      
      // Get page URL
      const url = window.location.href;
      
      return {
        title,
        url,
        fullContent: bodyText
      };
    });

    console.log(`  → Extracted ${pageContent.fullContent.length} characters of content`);

    // Send full page content to LLM for extraction and matching
    const analysisResult = await this._analyzeJobPageWithLLM(pageContent, job, profile, scanPrompt);
    
    return analysisResult;
  }

  // Analyze full job page content with LLM
  async _analyzeJobPageWithLLM(pageContent, job, profile, scanPrompt) {
    const prompt = `You are a job analysis system. Analyze the LinkedIn job page content and respond with ONLY a JSON object, no other text.

Candidate Profile:
${profile}

Additional Criteria:
${scanPrompt || 'None'}

Job Page Content:
${pageContent.fullContent.substring(0, 8000)}

Extract job details and provide a match score from 0.0 to 1.0.

Respond with ONLY this JSON format (no additional text):
{
  "title": "extracted job title",
  "company": "extracted company name",
  "location": "extracted location",
  "description": "extracted job description",
  "salary": "extracted salary or null",
  "matchScore": 0.8,
  "matchReason": "detailed explanation of match"
}`;

    // Try Cloudflare AI first
    try {
      console.log(`  → Analyzing full page with Cloudflare AI...`);
      const response = await this.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [{ role: 'user', content: prompt }]
      });
      console.log(`  → AI analysis complete`);

      try {
        // Clean and parse the response
        let cleanResponse = response.response
          .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
          .trim();
        
        // Try to extract JSON from the response - look for complete JSON objects
        let jsonMatch = cleanResponse.match(/\{[\s\S]*?"matchScore"[\s\S]*?\}/i);
        if (!jsonMatch) {
          // Try broader JSON pattern
          jsonMatch = cleanResponse.match(/\{[\s\S]*\}/i);
        }
        if (jsonMatch) {
          cleanResponse = jsonMatch[0];
        } else {
          // If no JSON found, log the response and try to extract key info
          console.log(`  → No JSON found in response: ${cleanResponse.substring(0, 200)}...`);
          throw new Error('No JSON structure found in AI response');
        }
        
        console.log(`  → Extracted JSON: ${cleanResponse.substring(0, 200)}...`);
        
        const result = JSON.parse(cleanResponse);
        
        return {
          title: result.title || job.title,
          company: result.company || job.company,
          location: result.location || job.location,
          description: result.description || 'No description extracted',
          salary: result.salary || null,
          matchScore: Math.max(0, Math.min(1, result.matchScore || 0)),
          matchReason: result.matchReason || 'No reason provided'
        };
        
      } catch (parseError) {
        console.error('Error parsing AI analysis:', parseError);
        console.log(`  → Falling back to keyword matching due to parse error`);
        return this._fallbackJobMatching({ 
          title: job.title,
          company: job.company,
          location: job.location,
          description: pageContent.fullContent.substring(0, 2000)
        }, profile, scanPrompt);
      }
      
    } catch (aiError) {
      console.log(`  → AI analysis failed: ${aiError.message}`);
      console.log(`  → Using fallback keyword matching...`);
      return this._fallbackJobMatching({ 
        title: job.title,
        company: job.company,
        location: job.location,
        description: pageContent.fullContent.substring(0, 2000)
      }, profile, scanPrompt);
    }
  }

  // Match job to profile using AI with fallback
  async _matchJobToProfile(jobDetails, profile, scanPrompt) {
    try {
      const prompt = `
Analyze this job posting and determine how well it matches the candidate profile.

Candidate Profile:
${profile}

Additional Criteria:
${scanPrompt || 'None'}

Job Details:
Title: ${jobDetails.title}
Company: ${jobDetails.company}
Location: ${jobDetails.location}
Description: ${jobDetails.description}

Provide a match score from 0.0 to 1.0 and a brief explanation.
Respond in JSON format: {"matchScore": 0.8, "matchReason": "explanation"}`;

      // Try Cloudflare AI first
      let response;
      try {
        console.log(`  → Attempting AI match with Cloudflare AI...`);
        response = await this.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
          messages: [{ role: 'user', content: prompt }]
        });
        console.log(`  → Cloudflare AI response received`);
      } catch (aiError) {
        console.log(`  → Cloudflare AI failed: ${aiError.message}`);
        
        // Fallback to simple keyword matching
        console.log(`  → Using fallback keyword matching...`);
        return this._fallbackJobMatching(jobDetails, profile, scanPrompt);
      }

      try {
        // Clean the response by removing control characters and fixing common issues
        let cleanResponse = response.response
          .replace(/[\x00-\x1F\x7F-\x9F]/g, '') // Remove control characters
          .replace(/\\n/g, '\n') // Fix escaped newlines
          .replace(/\\t/g, '\t') // Fix escaped tabs
          .trim();
        
        // Try to extract JSON from the response if it's wrapped in other text
        const jsonMatch = cleanResponse.match(/\{[^}]*"matchScore"[^}]*\}/i);
        if (jsonMatch) {
          cleanResponse = jsonMatch[0];
        }
        
        console.log('Cleaned AI response:', cleanResponse);
        const result = JSON.parse(cleanResponse);
        
        return {
          matchScore: Math.max(0, Math.min(1, result.matchScore || 0)),
          matchReason: result.matchReason || 'No reason provided'
        };
      } catch (parseError) {
        console.error('Error parsing AI response:', parseError);
        console.error('Raw AI response:', response.response);
        
        // Try to extract a numeric score from the response as fallback
        const scoreMatch = response.response.match(/(?:score|rating)[:\s]*([0-9.]+)/i);
        const fallbackScore = scoreMatch ? parseFloat(scoreMatch[1]) : 0;
        
        return { 
          matchScore: Math.max(0, Math.min(1, fallbackScore)), 
          matchReason: 'Could not parse structured response, extracted fallback score' 
        };
      }
    } catch (error) {
      console.error('Error in AI matching:', error);
      console.log(`  → Falling back to keyword matching due to error`);
      return this._fallbackJobMatching(jobDetails, profile, scanPrompt);
    }
  }

  // Fallback keyword matching when AI is unavailable
  _fallbackJobMatching(jobDetails, profile, scanPrompt) {
    try {
      console.log(`  → Running fallback keyword matching...`);
      
      const jobText = `${jobDetails.title} ${jobDetails.company} ${jobDetails.location} ${jobDetails.description}`.toLowerCase();
      const profileText = `${profile} ${scanPrompt}`.toLowerCase();
      
      // Extract keywords from profile
      const profileKeywords = profileText.match(/\b\w{3,}\b/g) || [];
      const uniqueKeywords = [...new Set(profileKeywords)];
      
      // Score based on keyword matches
      let matchCount = 0;
      let totalKeywords = Math.min(uniqueKeywords.length, 20); // Limit to top 20 keywords
      
      const matchedKeywords = [];
      
      for (const keyword of uniqueKeywords.slice(0, 20)) {
        if (jobText.includes(keyword)) {
          matchCount++;
          matchedKeywords.push(keyword);
        }
      }
      
      // Bonus scoring for important terms
      const bonusTerms = ['engineer', 'software', 'mechanical', 'new york', 'nyc', 'remote'];
      let bonusScore = 0;
      
      for (const term of bonusTerms) {
        if (jobText.includes(term) && profileText.includes(term)) {
          bonusScore += 0.1;
        }
      }
      
      // Calculate final score
      const baseScore = totalKeywords > 0 ? matchCount / totalKeywords : 0;
      const finalScore = Math.min(1.0, baseScore + bonusScore);
      
      const reason = `Keyword matching: ${matchCount}/${totalKeywords} keywords matched. ` +
                    `Matched terms: ${matchedKeywords.slice(0, 5).join(', ')}${matchedKeywords.length > 5 ? '...' : ''}. ` +
                    `Bonus score: +${bonusScore.toFixed(1)} for important terms.`;
      
      console.log(`  → Fallback match score: ${finalScore.toFixed(2)}`);
      
      return {
        matchScore: Math.round(finalScore * 100) / 100, // Round to 2 decimals
        matchReason: reason
      };
      
    } catch (error) {
      console.error('Error in fallback matching:', error);
      return {
        matchScore: 0.5, // Default neutral score
        matchReason: 'Fallback matching failed, assigned neutral score'
      };
    }
  }

	_generateSearchUrls(searchTerms, locations) {
		const baseUrl = 'https://www.linkedin.com/jobs/search/';
		const urls = [];

		if (!locations || locations.length === 0) {
			searchTerms.forEach(term => {
				urls.push({
					term,
					location: 'Any',
					url: `${baseUrl}?keywords=${encodeURIComponent(term)}&sortBy=DD`
				});
			});
			return urls;
		}

		searchTerms.forEach(term => {
			locations.forEach(loc => {
				let url = `${baseUrl}?keywords=${encodeURIComponent(term)}`;
				if (loc.name && loc.name !== 'Remote') {
					url += `&location=${encodeURIComponent(loc.name)}`;
					if (loc.type === 'city' && loc.distance) {
						url += `&distance=${loc.distance}`;
					}
				} else if (loc.name === 'Remote') {
					const countryLocation = locations.find(l => l.type === 'country');
					if (countryLocation && countryLocation.name) {
						url += `&f_WT=2&location=${encodeURIComponent(countryLocation.name)}`;
					} else {
						url += '&f_WT=2';
					}
				}
				url += '&sortBy=DD';
				urls.push({
					term,
					location: loc.name,
					url
				});
			});
		});

		return urls;
	}

	async _generatePlanFeedback(plan) {
		const prompt = `Analyze this job search plan and provide specific, actionable feedback on how it could be improved:\n\n${JSON.stringify(plan, null, 2)}\n\nFocus on:\n1. Search term quality (specificity, relevance, Boolean operators)\n2. Location coverage (missing important areas?)\n3. Profile completeness (skills, experience level, industry focus)\n4. Scan prompt effectiveness\n\nRespond with a JSON object with these fields:\n- "searchTermsFeedback": String with suggestions for search terms\n- "locationsFeedback": String with suggestions for locations\n- "profileFeedback": String with suggestions for profile\n- "scanPromptFeedback": String with suggestions for scan prompt\n- "overallRating": Number from 1-10 indicating plan quality\n\nKeep each feedback field concise (1-2 sentences).`;

		console.log("--- FEEDBACK AI PROMPT ---");
		console.log(prompt);

		const response = await this.openai.chat.completions.create({
			model: this.env.OPENAI_MODEL || 'gpt-4o',
			messages: [
				{ role: 'system', content: 'You analyze job search plans and provide concise, actionable feedback.' },
				{ role: 'user', content: prompt }
			],
			temperature: 0.3
		});

		const content = response.choices[0].message.content;
		console.log("--- FEEDBACK AI RAW RESPONSE ---");
		console.log(content);

		const jsonMatch = content.match(/\{[\s\S]*\}/);
		let feedback;
		try {
			feedback = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
			console.log("--- PARSED FEEDBACK ---");
			console.log(JSON.stringify(feedback, null, 2));
		} catch (e) {
			console.error("--- FEEDBACK JSON PARSE ERROR ---", e);
			feedback = {
				searchTermsFeedback: "Unable to analyze search terms.",
				locationsFeedback: "Unable to analyze locations.",
				profileFeedback: "Unable to analyze profile.",
				scanPromptFeedback: "Unable to analyze scan prompt.",
				overallRating: 0
			};
		}

		return feedback;
	}
}

// Function to validate required environment variables
function validateEnv(env) {
	const requiredVars = ['ACCESS_TOKEN'];
	const missing = requiredVars.filter(varName => !env[varName]);
	
	if (missing.length > 0) {
		return {
			valid: false,
			missing
		};
	}
	
	return { valid: true };
}

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);

		// Add CORS headers to all responses
		const corsHeaders = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, Authorization',
		};

		// Handle OPTIONS requests for CORS preflight
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				status: 204,
				headers: corsHeaders
			});
		}

		// Add a simple health check endpoint (no auth required)
		if (url.pathname === "/health") {
			// Even for health check, validate that required env vars are present
			const envValidation = validateEnv(env);
			if (!envValidation.valid) {
				console.error("Server configuration incomplete. Missing required environment variables: " + envValidation.missing.join(", "));
				return new Response(JSON.stringify({ 
					status: "error", 
					error: "Server configuration incomplete", 
					missing: envValidation.missing 
				}), { 
					status: 500,
					headers: { 
						"Content-Type": "application/json",
						...corsHeaders 
					}
				});
			}
			
			return new Response(JSON.stringify({ status: "ok" }), { 
				status: 200,
				headers: { 
					"Content-Type": "application/json",
					...corsHeaders 
				}
			});
		}

		// Validate required environment variables
		const envValidation = validateEnv(env);
		if (!envValidation.valid) {
			console.error("Server configuration incomplete. Missing required environment variables: " + envValidation.missing.join(", "));
			return new Response(JSON.stringify({ 
				error: "Server configuration incomplete. Missing required environment variables: " + envValidation.missing.join(", ")
			}), { 
				status: 500,
				headers: { 
					"Content-Type": "application/json",
					...corsHeaders 
				}
			});
		}

		// Handle SSE endpoints
		if (url.pathname === "/sse" || url.pathname === "/sse/message") {
			return JobSearchMCP.serveSSE("/sse").fetch(request, env, ctx);
		}

		// Handle MCP endpoint with authentication
		if (url.pathname === "/mcp") {
			// Check for authentication token
			const authHeader = request.headers.get('Authorization');
			const expectedToken = env.ACCESS_TOKEN;

			// Check if the token is valid (format: 'Bearer TOKEN')
			if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.replace('Bearer ', '') !== expectedToken) {
				console.error("Unauthorized: Invalid or missing authentication token");
				return new Response(JSON.stringify({ error: 'Unauthorized: Invalid or missing authentication token' }), { 
					status: 401,
					headers: { 
						"Content-Type": "application/json",
						...corsHeaders 
					}
				});
			}

			// Authentication passed, proceed to MCP handler
			return JobSearchMCP.serve("/mcp").fetch(request, env, ctx);
		}

		return new Response("Not found", { 
			status: 404,
			headers: corsHeaders
		});
	},
};