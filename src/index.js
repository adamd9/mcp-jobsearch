import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import OpenAI from "openai";
import { launch } from "@cloudflare/playwright";
import { getPlanTool, createPlanTool, updatePlanTool } from "./plan.js";
import { getScanTool, getRescanTool } from "./scan.js";
import { generateJobId, performSingleJobDeepScan } from "./scan-helpers.js";
import { 
  checkSmtpConfiguration, 
  getJobsForDigest, 
  markJobsAsSent, 
  filterJobsForDigest, 
  sendDigestEmail, 
  autoSendDigest 
} from './digest.js';

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
            id: generateJobId(url),
            url: url,
            title: 'Manual Deep Scan',
            company: 'Unknown',
            location: 'Unknown'
          };

          // Use the shared deep scan logic with timeout protection
          console.log(`Starting deep scan with 60-second timeout...`);
          console.log(`Mock job object:`, JSON.stringify(mockJob, null, 2));
          
          let scanResult;
          try {
            scanResult = await performSingleJobDeepScan(this, mockJob, plan.profile, plan.scanPrompt || '');
            console.log(`CHECKPOINT 1: Deep scan method returned`);
            console.log(`CHECKPOINT 2: About to log result for ${url}`);
            console.log(`Deep scan method returned result for ${url}`);
            console.log(`CHECKPOINT 3: About to stringify scan result`);
            console.log(`Scan result object:`, JSON.stringify(scanResult, null, 2));
            console.log(`CHECKPOINT 4: Scan result logged successfully`);
          } catch (deepScanError) {
            console.error(`Deep scan failed with error:`, deepScanError);
            throw deepScanError;
          }
          
          // Update job index with scan results if the job exists in the index
          console.log(`Attempting to update job index for ${url}`);
          
          let jobIndex = null;
          try {
            jobIndex = await this.env.JOB_STORAGE.get('job_index', 'json');
            console.log(`Retrieved job index, has ${jobIndex?.jobs?.length || 0} jobs`);
            if (jobIndex && jobIndex.jobs) {
              console.log(`Job index exists, searching for job with URL: ${url}`);
              // Find existing job by URL
              const existingJobIndex = jobIndex.jobs.findIndex(j => j.url === url);
              console.log(`Job search result: index ${existingJobIndex}`);
              
              if (existingJobIndex !== -1) {
                console.log(`Found existing job at index ${existingJobIndex}, updating...`);
                // Update existing job with scan results
                const existingJob = jobIndex.jobs[existingJobIndex];
                existingJob.scanned = true;
                existingJob.scanDate = new Date().toISOString();
                existingJob.matchScore = scanResult.matchScore || 0;
                existingJob.matchReason = scanResult.matchReason || '';
                existingJob.description = scanResult.description || existingJob.description;
                existingJob.title = scanResult.title || existingJob.title;
                existingJob.company = scanResult.company || existingJob.company;
                existingJob.location = scanResult.location || existingJob.location;
                existingJob.salary = scanResult.salary || existingJob.salary;
                existingJob.scanStatus = 'completed';
                
                // Save updated index
                console.log(`Saving updated job index...`);
                jobIndex.lastUpdate = new Date().toISOString();
                await this.env.JOB_STORAGE.put('job_index', JSON.stringify(jobIndex));
                console.log(`Job index saved successfully`);
                
                console.log(`Updated job index with manual deep scan results for: ${existingJob.title}`);
              } else {
                console.log(`Job not found in index, scan results not persisted: ${url}`);
              }
            } else {
              console.log(`No job index found or jobs array missing`);
            }
          } catch (indexError) {
            console.error('Error updating job index with manual scan results:', indexError);
            // Don't fail the whole operation if index update fails
          }
          
          console.log(`Job index update section completed, preparing final result...`);
            
          const result = {
            content: [{ 
              type: "text", 
              text: `Deep scan completed for ${url}\n\nMatch Score: ${scanResult.matchScore}\nMatch Reason: ${scanResult.matchReason}\n\nJob Details:\nTitle: ${scanResult.title}\nCompany: ${scanResult.company}\nLocation: ${scanResult.location}\n\nDescription: ${scanResult.description?.substring(0, 500)}...\n\n${jobIndex && jobIndex.jobs.find(j => j.url === url) ? '✓ Job index updated with scan results' : 'ℹ Job not found in index - results not persisted'}` 
            }],
            structuredContent: {
              url,
              scanResult,
              success: true,
              indexUpdated: jobIndex && jobIndex.jobs.find(j => j.url === url) ? true : false
            }
          };
          
          console.log(`Returning successful deep scan result to MCP client`);
          return result;
        } catch (error) {
          console.error('Manual deep scan error:', error);
          const errorResult = {
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
          
          console.log(`Returning error result to MCP client: ${error.message}`);
          return errorResult;
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
      "get_job_index",
      "Get the current raw job index data for inspection",
      {
        excludeJobDetails: z.boolean().optional().describe("Exclude job details from output (only show summary)"),
        maxJobs: z.number().optional().describe("Maximum number of jobs to include (default: all)")
      },
      async ({ excludeJobDetails = false, maxJobs }) => {
        const includeJobDetails = !excludeJobDetails;
        try {
          const jobIndex = await this.env.JOB_STORAGE.get('job_index', 'json');
          
          if (!jobIndex) {
            return {
              content: [{ 
                type: "text", 
                text: "No job index found. Run a scan first to create the job index." 
              }],
              structuredContent: { 
                exists: false,
                jobs: [],
                totalJobs: 0
              }
            };
          }

          const totalJobs = jobIndex.jobs?.length || 0;
          let jobsToShow = jobIndex.jobs || [];
          
          // Limit number of jobs if specified
          if (maxJobs && maxJobs > 0) {
            jobsToShow = jobsToShow.slice(0, maxJobs);
          }
          
          // Create summary stats
          const scannedJobs = jobIndex.jobs?.filter(j => j.scanned) || [];
          const errorJobs = jobIndex.jobs?.filter(j => j.scanStatus === 'error') || [];
          const completedJobs = jobIndex.jobs?.filter(j => j.scanStatus === 'completed') || [];
          
          const stats = {
            totalJobs,
            scannedJobs: scannedJobs.length,
            completedScans: completedJobs.length,
            errorScans: errorJobs.length,
            pendingScans: totalJobs - scannedJobs.length,
            lastScanDate: jobIndex.lastScanDate,
            lastUpdate: jobIndex.lastUpdate,
            profileHash: jobIndex.profileHash
          };
          
          let responseText = `Job Index Summary:\n`;
          responseText += `• Total Jobs: ${stats.totalJobs}\n`;
          responseText += `• Scanned: ${stats.scannedJobs} (${stats.completedScans} completed, ${stats.errorScans} errors)\n`;
          responseText += `• Pending: ${stats.pendingScans}\n`;
          responseText += `• Last Scan: ${stats.lastScanDate || 'Never'}\n`;
          responseText += `• Last Update: ${stats.lastUpdate || 'Never'}\n\n`;
          
          if (maxJobs && totalJobs > maxJobs) {
            responseText += `Showing first ${maxJobs} of ${totalJobs} jobs:\n\n`;
          }
          
          // Add job details if requested
          if (includeJobDetails && jobsToShow.length > 0) {
            jobsToShow.forEach((job, i) => {
              responseText += `${i + 1}. ${job.title} at ${job.company}\n`;
              responseText += `   URL: ${job.url}\n`;
              responseText += `   Location: ${job.location || 'Unknown'}\n`;
              responseText += `   Scanned: ${job.scanned ? 'Yes' : 'No'}`;
              if (job.scanned) {
                responseText += ` (${job.scanStatus || 'unknown'}, score: ${job.matchScore || 0})`;
              }
              responseText += `\n`;
              if (job.scanError) {
                responseText += `   Error: ${job.scanError.message}\n`;
              }
              responseText += `\n`;
            });
          }
          
          return {
            content: [{ 
              type: "text", 
              text: responseText 
            }],
            structuredContent: {
              exists: true,
              stats,
              jobs: includeJobDetails ? jobsToShow : jobsToShow.map(j => ({
                id: j.id,
                title: j.title,
                company: j.company,
                scanned: j.scanned,
                scanStatus: j.scanStatus,
                matchScore: j.matchScore
              })),
              rawIndex: jobIndex
            }
          };
        } catch (error) {
          console.error('Error getting job index:', error);
          return {
            content: [{ 
              type: "text", 
              text: `Error retrieving job index: ${error.message}` 
            }],
            structuredContent: { 
              exists: false,
              error: error.message
            },
            isError: true
          };
        }
      },
      {
        title: "Get Job Index",
        readOnlyHint: true,
        openWorldHint: false
      }
    );

    this.server.tool(
      "send_digest",
      "Send digest email with job matches to the specified email address",
      {
        email: z.string().optional().describe("Email address to send digest to (uses DIGEST_TO env var if not provided)"),
        includePreviouslySent: z.boolean().optional().describe("Include previously sent jobs along with new ones"),
        minMatchScore: z.number().optional().describe("Minimum match score to include jobs (0.0-1.0, default: 0.0)"),
        subject: z.string().optional().describe("Custom email subject line"),
        test: z.boolean().optional().describe("Test mode - sends a sample email with mock job data")
      },
      async ({ email, includePreviouslySent = false, minMatchScore = 0.0, subject, test = false }) => {
        const onlyNew = !includePreviouslySent;
        try {
          // Check SMTP configuration
          const smtpCheck = checkSmtpConfiguration(this.env);
          if (!smtpCheck.isConfigured) {
            return {
              content: [{ 
                type: "text", 
                text: `SMTP not configured. Missing environment variables: ${smtpCheck.missingVars.join(', ')}` 
              }],
              structuredContent: { 
                success: false, 
                error: 'SMTP not configured',
                missingVars: smtpCheck.missingVars
              },
              isError: true
            };
          }
          
          // Use provided email or fall back to DIGEST_TO env var
          const toEmail = email || this.env.DIGEST_TO;
          if (!toEmail) {
            return {
              content: [{ 
                type: "text", 
                text: "No email address provided and DIGEST_TO environment variable not set" 
              }],
              structuredContent: { 
                success: false, 
                error: 'No email address specified'
              },
              isError: true
            };
          }
          
          let jobsToSend;
          
          // Handle test mode with mock data
          if (test) {
            jobsToSend = [
              {
                id: 'test-job-1',
                title: 'Senior Software Engineer',
                company: 'TechCorp Inc.',
                location: 'San Francisco, CA',
                url: 'https://linkedin.com/jobs/view/test123',
                matchScore: 0.92,
                matchReason: 'Strong match for Python, React, and cloud architecture experience',
                description: 'We are seeking a Senior Software Engineer to join our growing team...',
                salary: '$150,000 - $200,000',
                scanned: true,
                scanStatus: 'completed'
              },
              {
                id: 'test-job-2',
                title: 'Full Stack Developer',
                company: 'StartupCo',
                location: 'Remote',
                url: 'https://linkedin.com/jobs/view/test456',
                matchScore: 0.85,
                matchReason: 'Good fit for JavaScript, Node.js, and database skills',
                description: 'Join our innovative startup as a Full Stack Developer...',
                salary: '$120,000 - $160,000',
                scanned: true,
                scanStatus: 'completed'
              },
              {
                id: 'test-job-3',
                title: 'DevOps Engineer',
                company: 'CloudTech Solutions',
                location: 'Austin, TX',
                url: 'https://linkedin.com/jobs/view/test789',
                matchScore: 0.78,
                matchReason: 'Matches AWS, Docker, and Kubernetes requirements',
                description: 'Looking for a DevOps Engineer to manage our cloud infrastructure...',
                salary: '$130,000 - $170,000',
                scanned: true,
                scanStatus: 'completed'
              }
            ];
            
            console.log('Test mode: Using mock job data for digest email');
          } else {
            // Normal mode: get real job data
          
            // Get job index
            const jobIndex = await this.env.JOB_STORAGE.get('job_index', 'json');
            if (!jobIndex || !jobIndex.jobs || jobIndex.jobs.length === 0) {
              return {
                content: [{ 
                  type: "text", 
                  text: "No jobs found in index. Run a scan first to generate job matches." 
                }],
                structuredContent: { 
                  success: false, 
                  error: 'No jobs in index'
                }
              };
            }
            
            // Filter jobs based on criteria
            jobsToSend = filterJobsForDigest(jobIndex.jobs, { onlyNew, minMatchScore });
          }
          
          if (jobsToSend.length === 0) {
            const message = onlyNew ? 'No new job matches to send in digest email' : 'No job matches meet the specified criteria';
            return {
              content: [{ 
                type: "text", 
                text: message 
              }],
              structuredContent: { 
                success: false, 
                error: 'No jobs to send',
                totalJobs: jobIndex.jobs.length,
                filteredJobs: 0
              }
            };
          }
          
          // Sort by match score descending
          jobsToSend.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
          
          // Send email using external digest module
          const emailResult = await sendDigestEmail(toEmail, jobsToSend, this.env, {
            subject: subject || (test ? 'Test Digest Email - Sample Job Matches' : undefined),
            onlyNew: test ? false : onlyNew, // Don't apply onlyNew filter in test mode
            source: test ? 'test' : 'manual'
          });
          
          if (emailResult.success) {
            // Mark jobs as sent if onlyNew is true and not in test mode
            if (onlyNew && !test) {
              await markJobsAsSent(this.env);
            }
            
            const testModeText = test ? ' (TEST MODE - mock data)' : (onlyNew ? ' (new)' : '');
            
            return {
              content: [{ 
                type: "text", 
                text: `Successfully sent digest email to ${toEmail} with ${jobsToSend.length} job matches${testModeText}${test ? '\n\nThis was a test email with sample job data to verify your email configuration.' : ''}` 
              }],
              structuredContent: { 
                success: true,
                email: toEmail,
                jobsSent: jobsToSend.length,
                onlyNew: test ? false : onlyNew,
                minMatchScore,
                testMode: test
              }
            };
          } else {
            return {
              content: [{ 
                type: "text", 
                text: `Failed to send digest email: ${emailResult.error}` 
              }],
              structuredContent: { 
                success: false,
                error: emailResult.error
              },
              isError: true
            };
          }
        } catch (error) {
          console.error('Error in send_digest tool:', error);
          return {
            content: [{ 
              type: "text", 
              text: `Error sending digest: ${error.message}` 
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
        title: "Send Job Digest Email",
        readOnlyHint: false,
        openWorldHint: false
      }
    );
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
    
    console.log(`  → Deep scan completed for ${job.url}, match score: ${analysisResult.matchScore}`);
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
        
        const analysisResult = {
          title: result.title || job.title,
          company: result.company || job.company,
          location: result.location || job.location,
          description: result.description || 'No description extracted',
          salary: result.salary || null,
          matchScore: Math.max(0, Math.min(1, result.matchScore || 0)),
          matchReason: result.matchReason || 'No reason provided'
        };
        
        console.log(`  → AI analysis result prepared: ${analysisResult.title} at ${analysisResult.company}`);
        return analysisResult;
        
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