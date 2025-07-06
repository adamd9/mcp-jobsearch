import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getPlan, savePlan, createPlanFromDescription } from "./plan.js";
import { loadConfig } from "./config.js";
import { scrapeLinkedIn } from "./scrape.js";
import { deepScanJobs } from "./deep-scan.js";
import { sendDigest } from "./mailer.js";
import {
  getJobIndex,
  updateJobIndex,
  markJobAsScanned,
  getMatchedJobs,
  getJobsToScan,
  hasProfileChanged,
} from "./storage.js";
import fs from "fs/promises";
import path from "path";

// Track background jobs
const backgroundJobs = {
  scan: {
    inProgress: false,
    startTime: null,
    endTime: null,
    status: 'idle', // idle, running, completed, error
    totalJobs: 0,
    scannedJobs: 0,
    error: null
  },
  rescan: {
    inProgress: false,
    startTime: null,
    endTime: null,
    status: 'idle', // idle, running, completed, error
    totalJobs: 0,
    scannedJobs: 0,
    error: null
  }
};

export function createServer() {
  const mcpServer = new McpServer({
    name: "jobsearch-mcp",
    version: "1.0.0",
  });

  // Plan tools
  mcpServer.tool(
    "get_plan",
    "Get the current job search plan",
    async () => {
      const plan = await getPlan();
      return {
        content: [{ type: "text", text: JSON.stringify(plan, null, 2) }],
        structuredContent: plan,
      };
    },
    {
      title: "Get Job Search Plan",
      readOnlyHint: true,
      openWorldHint: false
    }
  );

  mcpServer.tool(
    "create_plan",
    "Create a new job search plan from a description",
    {
      description: z.string().describe("Description of the job search plan")
    },
    async ({ description }) => {
      const plan = await createPlanFromDescription(description);
      return {
        content: [{ type: "text", text: JSON.stringify(plan, null, 2) }],
        structuredContent: plan,
      };
    },
    {
      title: "Create Job Search Plan",
      readOnlyHint: false,
      openWorldHint: false
    }
  );

  mcpServer.tool(
    "update_plan",
    "Update the existing job search plan with new values",
    z.record(z.any()).describe("Fields to update in the job search plan"),
    async (updates) => {
      const current = await getPlan();
      const updated = { ...current, ...updates };
      await savePlan(updated);
      return {
        content: [{ type: "text", text: JSON.stringify(updated, null, 2) }],
        structuredContent: updated,
      };
    },
    {
      title: "Update Job Search Plan",
      readOnlyHint: false,
      openWorldHint: true
    }
  );

  // Scan jobs without sending digest
  mcpServer.tool(
    "scan",
    "Scan LinkedIn for jobs based on search terms in the plan",
    {},
    async () => {
      // Reset scan job status
      backgroundJobs.scan = {
        inProgress: true,
        startTime: Date.now(),
        endTime: null,
        status: 'running',
        totalJobs: 0,
        scannedJobs: 0,
        error: null
      };
      
      const config = await loadConfig();
      const plan = await getPlan();
      
      try {
        // Start the scan process in the background
        (async () => {
          try {
            if (config.mockMode) {
              // Mock only the scraping part
              const mockDataPath = path.join(
                process.cwd(),
                "test/fixtures/linkedin-search-results.json"
              );
              const mockJobs = JSON.parse(await fs.readFile(mockDataPath, "utf8"));
              await updateJobIndex(mockJobs);
              console.log(`Added ${mockJobs.length} mock jobs to index`);
              
              // Now perform deep scan on the mock jobs
              const profile = plan.profile || 
                await fs.readFile(path.join(process.cwd(), 'profile.txt'), 'utf8');
              
              // Get jobs that need scanning
              const jobsToScan = await getJobsToScan();
              console.log(`Performing deep scan on ${jobsToScan.length} mock jobs`);
              
              // Update background job status
              backgroundJobs.scan.totalJobs = jobsToScan.length;
              
              if (jobsToScan.length > 0) {
                // Deep scan the jobs with real OpenAI assessment
                const concurrency = parseInt(process.env.DEEP_SCAN_CONCURRENCY || '2');
                
                // Track progress
                let scannedCount = 0;
                const progressCallback = () => {
                  scannedCount++;
                  backgroundJobs.scan.scannedJobs = scannedCount;
                };
                
                await deepScanJobs(jobsToScan, profile, concurrency, plan.scanPrompt, progressCallback);
                console.log('Deep scanning complete');
              }
            } else {
              // Non-mock mode: real scraping
              let total = 0;
              let jobs = [];
              
              for (const term of plan.searchTerms) {
                const url = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(
                  term
                )}`;
                const { jobs: scrapedJobs } = await scrapeLinkedIn(url, {
                  deepScan: true,
                  profileText: plan.profile,
                  scanPrompt: plan.scanPrompt,
                  progressCallback: (scanned, total) => {
                    backgroundJobs.scan.scannedJobs = scanned;
                    backgroundJobs.scan.totalJobs = total;
                  }
                });
                total += scrapedJobs.length;
                jobs = [...jobs, ...scrapedJobs];
              }
            }
            
            // Mark as completed
            backgroundJobs.scan.status = 'completed';
            backgroundJobs.scan.endTime = Date.now();
            backgroundJobs.scan.inProgress = false;
            console.log('Scan job completed successfully');
            
          } catch (error) {
            console.error('Error in background scan job:', error);
            backgroundJobs.scan.status = 'error';
            backgroundJobs.scan.error = error.message;
            backgroundJobs.scan.endTime = Date.now();
            backgroundJobs.scan.inProgress = false;
          }
        })();
        
        // Return immediately with job started status
        return {
          content: [{ 
            type: "text", 
            text: `Scan job started in the background. Use the 'status' tool to check progress.` 
          }],
          structuredContent: { 
            jobStarted: true,
            mockMode: config.mockMode,
            jobType: 'scan'
          },
        };
      } catch (error) {
        backgroundJobs.scan.status = 'error';
        backgroundJobs.scan.error = error.message;
        backgroundJobs.scan.endTime = Date.now();
        backgroundJobs.scan.inProgress = false;
        
        return {
          content: [{ type: "text", text: `Error starting scan job: ${error.message}` }],
          structuredContent: { error: error.message },
          isError: true
        };
      }
    },
    {
      title: "Scan LinkedIn Jobs",
      readOnlyHint: false,
      openWorldHint: false
    }
  );

  // Force rescan all jobs
  mcpServer.tool(
    "rescan",
    "Deep scan all jobs in the index and match against profile",
    {},
    async () => {
      // Reset rescan job status
      backgroundJobs.rescan = {
        inProgress: true,
        startTime: Date.now(),
        endTime: null,
        status: 'running',
        totalJobs: 0,
        scannedJobs: 0,
        error: null
      };
      
      const config = await loadConfig();
      const plan = await getPlan();
      
      try {
        // Start the rescan process in the background
        (async () => {
          try {
            // Get all jobs from the index
            const jobIndex = await getJobIndex();
            const jobs = jobIndex.jobs;
            
            // Update background job status
            backgroundJobs.rescan.totalJobs = jobs.length;
            
            // Get profile text
            const profile =
              plan.profile ||
              (await fs.readFile(path.join(process.cwd(), "profile.txt"), "utf8"));
            
            if (config.mockMode) {
              // In mock mode, we'll use the mock job details for descriptions
              // but still perform real assessment with OpenAI
              const mockDetailsPath = path.join(
                process.cwd(),
                "test/fixtures/linkedin-job-details.json"
              );
              const mockDetails = JSON.parse(await fs.readFile(mockDetailsPath, "utf8"));
              
              // Create a map of mock details by ID for easy lookup
              const mockDetailsMap = new Map();
              mockDetails.forEach(mockJob => {
                mockDetailsMap.set(mockJob.id, mockJob);
              });
              
              // Update jobs with mock details but don't set match scores yet
              for (const job of jobs) {
                const mockDetail = mockDetailsMap.get(job.id);
                if (mockDetail) {
                  // Only update job description and related fields, not the match results
                  await markJobAsScanned(job.id, {
                    description: mockDetail.description,
                    requirements: mockDetail.requirements,
                    salary: mockDetail.salary,
                    location: mockDetail.location,
                    // Mark as not scanned so deepScanJobs will process it
                    scanned: false,
                    scanDate: null,
                    // Reset match data
                    matchScore: null,
                    matchReason: null
                  });
                }
              }
              
              // Now perform real assessment with OpenAI
              console.log(`Performing real assessment on ${jobs.length} mock jobs`);
              const concurrency = parseInt(process.env.DEEP_SCAN_CONCURRENCY || '2');
              
              // Track progress
              let scannedCount = 0;
              const progressCallback = () => {
                scannedCount++;
                backgroundJobs.rescan.scannedJobs = scannedCount;
              };
              
              await deepScanJobs(
                jobs,
                profile,
                concurrency,
                plan.scanPrompt,
                progressCallback
              );
            } else {
              // Non-mock mode: perform real deep scan
              const progressCallback = () => {
                backgroundJobs.rescan.scannedJobs++;
              };
              
              await deepScanJobs(
                jobs,
                profile,
                config.deepScanConcurrency,
                plan.scanPrompt,
                progressCallback
              );
            }
            
            // Mark as completed
            backgroundJobs.rescan.status = 'completed';
            backgroundJobs.rescan.endTime = Date.now();
            backgroundJobs.rescan.inProgress = false;
            console.log('Rescan job completed successfully');
            
          } catch (error) {
            console.error('Error in background rescan job:', error);
            backgroundJobs.rescan.status = 'error';
            backgroundJobs.rescan.error = error.message;
            backgroundJobs.rescan.endTime = Date.now();
            backgroundJobs.rescan.inProgress = false;
          }
        })();
        
        // Return immediately with job started status
        return {
          content: [{ 
            type: "text", 
            text: `Rescan job started in the background. Use the 'status' tool to check progress.` 
          }],
          structuredContent: { 
            jobStarted: true,
            mockMode: config.mockMode,
            jobType: 'rescan'
          },
        };
      } catch (error) {
        backgroundJobs.rescan.status = 'error';
        backgroundJobs.rescan.error = error.message;
        backgroundJobs.rescan.endTime = Date.now();
        backgroundJobs.rescan.inProgress = false;
        
        return {
          content: [{ type: "text", text: `Error starting rescan job: ${error.message}` }],
          structuredContent: { error: error.message },
          isError: true
        };
      }
    },
    {
      title: "Rescan All Jobs",
      readOnlyHint: false,
      openWorldHint: false
    }
  );

  // Get jobs with optional filtering
  mcpServer.tool(
    "jobs",
    "Get jobs from the index with optional filtering",
    {
      minScore: z.number().optional().describe("Minimum match score (0-1)"),
      scanned: z.boolean().optional().describe("Filter by scan status"),
      limit: z.number().optional().describe("Maximum number of jobs to return"),
    },
    async ({ minScore, scanned, limit }) => {
      const jobIndex = await getJobIndex();
      let jobs = jobIndex.jobs;
      if (typeof minScore !== "undefined") {
        jobs = jobs.filter((j) => j.matchScore >= minScore);
      }
      if (typeof scanned !== "undefined") {
        jobs = jobs.filter((j) => j.scanned === scanned);
      }
      if (typeof limit !== "undefined") {
        jobs = jobs.slice(0, limit);
      }
      return {
        content: [{ 
          type: "text", 
          text: `Found ${jobs.length} jobs${minScore ? ` with score >= ${minScore}` : ''}${typeof scanned !== "undefined" ? ` (${scanned ? 'scanned' : 'not scanned'})` : ''}` 
        }],
        structuredContent: jobs,
      };
    },
    {
      title: "Get Jobs",
      readOnlyHint: true,
      openWorldHint: false
    }
  );

  // Get a specific job
  mcpServer.tool(
    "job",
    "Get details for a specific job by ID",
    {
      id: z.string().describe("Job ID to retrieve")
    },
    async ({ id }) => {
      const jobIndex = await getJobIndex();
      const job = jobIndex.jobs.find((j) => j.id === id);
      if (!job) {
        return {
          content: [{ type: "text", text: `Job with ID ${id} not found` }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(job, null, 2) }],
        structuredContent: job,
      };
    },
    {
      title: "Get Job Details",
      readOnlyHint: true,
      openWorldHint: false
    }
  );

  // Latest matches
  mcpServer.tool(
    "latest_matches",
    "Get the latest job matches with score >= 0.7",
    {},
    async () => {
      try {
        const matches = await getMatchedJobs(0.7);
        return {
          content: [{ 
            type: "text", 
            text: `Found ${matches.length} job matches with score >= 0.7` 
          }],
          structuredContent: matches,
        };
      } catch {
        const files = await fs.readdir("data");
        const latest = files.sort().pop();
        const matches = latest
          ? JSON.parse(await fs.readFile(`data/${latest}`))
          : [];
        return {
          content: [{ 
            type: "text", 
            text: `Found ${matches.length} job matches from backup file` 
          }],
          structuredContent: matches,
        };
      }
    },
    {
      title: "Get Latest Matches",
      readOnlyHint: true,
      openWorldHint: false
    }
  );

  // Status endpoint - Get current status of the job search service
  mcpServer.tool(
    "status",
    "Get the current status of the job search service",
    {},
    async () => {
      try {
        // Get current configuration
        const config = await loadConfig();
        
        // Get job index
        const jobIndex = await getJobIndex();
        const totalJobs = jobIndex.jobs.length;
        
        // Count scanned jobs
        const scannedJobs = jobIndex.jobs.filter(job => job.scanned).length;
        
        // Count matched jobs (score >= 0.7)
        const matchedJobs = jobIndex.jobs.filter(job => job.matchScore >= 0.7).length;
        
        // Get current plan
        const plan = await getPlan();
        const searchTerms = plan.searchTerms || [];
        
        // Get last update time from job index
        const lastUpdate = jobIndex.lastUpdated || 'Unknown';
        
        // Build status object
        const status = {
          totalJobs,
          scannedJobs,
          matchedJobs,
          searchTerms,
          lastUpdate,
          mockMode: config.mockMode || false,
          version: '1.0.0',
          serverTime: new Date().toISOString(),
          uptime: process.uptime().toFixed(2) + 's',
          // Add background job status
          backgroundJobs: {
            scan: { ...backgroundJobs.scan },
            rescan: { ...backgroundJobs.rescan }
          }
        };
        
        // Build status text
        let statusText = `Job Search Service Status:\n\nTotal Jobs: ${totalJobs}\nScanned Jobs: ${scannedJobs}\nMatched Jobs: ${matchedJobs}\nSearch Terms: ${searchTerms.join(', ')}\nLast Update: ${lastUpdate}\nMock Mode: ${status.mockMode ? 'ON' : 'OFF'}\nVersion: ${status.version}\nServer Time: ${status.serverTime}\nUptime: ${status.uptime}`;
        
        // Add background job status to text
        if (backgroundJobs.scan.status !== 'idle') {
          statusText += `\n\nScan Job: ${backgroundJobs.scan.status}\n`;
          if (backgroundJobs.scan.status === 'running') {
            statusText += `Progress: ${backgroundJobs.scan.scannedJobs}/${backgroundJobs.scan.totalJobs} jobs\n`;
            statusText += `Started: ${new Date(backgroundJobs.scan.startTime).toLocaleString()}\n`;
          } else if (backgroundJobs.scan.status === 'completed') {
            statusText += `Completed: ${new Date(backgroundJobs.scan.endTime).toLocaleString()}\n`;
            statusText += `Duration: ${Math.round((backgroundJobs.scan.endTime - backgroundJobs.scan.startTime) / 1000)}s\n`;
          } else if (backgroundJobs.scan.status === 'error') {
            statusText += `Error: ${backgroundJobs.scan.error}\n`;
          }
        }
        
        if (backgroundJobs.rescan.status !== 'idle') {
          statusText += `\n\nRescan Job: ${backgroundJobs.rescan.status}\n`;
          if (backgroundJobs.rescan.status === 'running') {
            statusText += `Progress: ${backgroundJobs.rescan.scannedJobs}/${backgroundJobs.rescan.totalJobs} jobs\n`;
            statusText += `Started: ${new Date(backgroundJobs.rescan.startTime).toLocaleString()}\n`;
          } else if (backgroundJobs.rescan.status === 'completed') {
            statusText += `Completed: ${new Date(backgroundJobs.rescan.endTime).toLocaleString()}\n`;
            statusText += `Duration: ${Math.round((backgroundJobs.rescan.endTime - backgroundJobs.rescan.startTime) / 1000)}s\n`;
          } else if (backgroundJobs.rescan.status === 'error') {
            statusText += `Error: ${backgroundJobs.rescan.error}\n`;
          }
        }
        
        return {
          content: [{ 
            type: "text", 
            text: statusText
          }],
          structuredContent: status,
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error getting status: ${error.message}` }],
          isError: true,
        };
      }
    },
    {
      title: "Service Status",
      readOnlyHint: true,
      openWorldHint: false,
      examples: [{ input: {}, output: { totalJobs: 42, scannedJobs: 30, matchedJobs: 15 } }]
    }
  );

  // Send digest email
  mcpServer.tool(
    "send_digest",
    "Scan for jobs, match against profile, and send digest email",
    {
      email: z.string().describe("Email address to send digest to")
    },
    async ({ email }) => {
      const config = await loadConfig();
      const plan = await getPlan();
      
      if (config.mockMode) {
        console.log("Running send_digest in mock mode with real assessment");
        
        // Mock the scraping part
        const mockDataPath = path.join(
          process.cwd(),
          "test/fixtures/linkedin-search-results.json"
        );
        const mockJobs = JSON.parse(await fs.readFile(mockDataPath, "utf8"));
        await updateJobIndex(mockJobs);
        console.log(`Added ${mockJobs.length} mock jobs to index`);
        
        // Get mock job details but don't set match scores yet
        const mockDetailsPath = path.join(
          process.cwd(),
          "test/fixtures/linkedin-job-details.json"
        );
        const mockDetails = JSON.parse(await fs.readFile(mockDetailsPath, "utf8"));
        
        // Create a map of mock details by ID for easy lookup
        const mockDetailsMap = new Map();
        mockDetails.forEach(mockJob => {
          mockDetailsMap.set(mockJob.id, mockJob);
        });
        
        // Update jobs with mock details but reset scan status
        const jobIndex = await getJobIndex();
        for (const job of jobIndex.jobs) {
          const mockDetail = mockDetailsMap.get(job.id);
          if (mockDetail) {
            // Only update job description and related fields, not the match results
            await markJobAsScanned(job.id, {
              description: mockDetail.description,
              requirements: mockDetail.requirements,
              salary: mockDetail.salary,
              location: mockDetail.location,
              // Mark as not scanned so deepScanJobs will process it
              scanned: false,
              scanDate: null,
              // Reset match data
              matchScore: null,
              matchReason: null
            });
          }
        }
        
        // Now perform real assessment with OpenAI
        const profile = plan.profile || 
          await fs.readFile(path.join(process.cwd(), 'profile.txt'), 'utf8');
        
        // Get jobs that need scanning
        const jobsToScan = await getJobsToScan();
        console.log(`Performing real assessment on ${jobsToScan.length} mock jobs`);
        
        if (jobsToScan.length > 0) {
          // Deep scan the jobs with real OpenAI assessment
          const concurrency = parseInt(process.env.DEEP_SCAN_CONCURRENCY || '2');
          await deepScanJobs(jobsToScan, profile, concurrency, plan.scanPrompt);
          console.log('Deep scanning complete');
        }
        
        // Get matches and send digest
        const matches = await getMatchedJobs(0.7);
        await sendDigest(email, matches);
        
        return {
          content: [
            { type: "text", text: `Sent digest email to ${email} with ${matches.length} job matches (mock scraping, real assessment)` },
          ],
          structuredContent: { 
            sent: matches.length, 
            mock: "partial", 
            realAssessment: true,
            email 
          },
        };
      }
      
      // Non-mock mode: real scraping and assessment
      for (const term of plan.searchTerms) {
        const url = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(
          term
        )}`;
        await scrapeLinkedIn(url, {
          deepScan: true,
          profileText: plan.profile,
          scanPrompt: plan.scanPrompt,
        });
      }
      const matches = await getMatchedJobs(0.7);
      await sendDigest(email || config.digestTo, matches);
      return {
        content: [{ type: "text", text: `Sent digest email to ${email || config.digestTo} with ${matches.length} job matches` }],
        structuredContent: { sent: matches.length, email: email || config.digestTo },
      };
    },
    {
      title: "Send Job Digest Email",
      readOnlyHint: false,
      openWorldHint: false
    }
  );

  return mcpServer.server;
}
