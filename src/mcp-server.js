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
} from "./storage.js";
import fs from "fs/promises";
import path from "path";

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
      const config = await loadConfig();
      if (config.mockMode) {
        const mockDataPath = path.join(
          process.cwd(),
          "test/fixtures/linkedin-search-results.json"
        );
        const mockJobs = JSON.parse(await fs.readFile(mockDataPath, "utf8"));
        await updateJobIndex(mockJobs);
        return {
          content: [{ type: "text", text: `Scanned ${mockJobs.length} mock jobs` }],
          structuredContent: { scanned: mockJobs.length, mock: true },
        };
      }
      const plan = await getPlan();
      let total = 0;
      for (const term of plan.searchTerms) {
        const url = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(
          term
        )}`;
        const { jobs } = await scrapeLinkedIn(url);
        total += jobs.length;
      }
      return {
        content: [{ type: "text", text: `Scanned ${total} jobs` }],
        structuredContent: { scanned: total },
      };
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
      const config = await loadConfig();
      if (config.mockMode) {
        const mockDetailsPath = path.join(
          process.cwd(),
          "test/fixtures/linkedin-job-details.json"
        );
        const mockDetails = JSON.parse(await fs.readFile(mockDetailsPath, "utf8"));
        for (const mockJob of mockDetails) {
          await markJobAsScanned(mockJob.id, {
            matchScore: mockJob.matchScore,
            matchReason: mockJob.matchReason,
            description: mockJob.description,
            requirements: mockJob.requirements,
            salary: mockJob.salary,
            location: mockJob.location,
            scanned: true,
            scanDate: new Date().toISOString(),
          });
        }
        return {
          content: [
            { type: "text", text: `Rescanned ${mockDetails.length} mock jobs` },
          ],
          structuredContent: { rescanned: mockDetails.length, mock: true },
        };
      }
      const jobs = await getJobIndex();
      const plan = await getPlan();
      const profile =
        plan.profile ||
        (await fs.readFile(path.join(process.cwd(), "profile.txt"), "utf8"));
      const results = await deepScanJobs(
        jobs,
        profile,
        config.deepScanConcurrency,
        plan.scanPrompt
      );
      return {
        content: [{ type: "text", text: `Rescanned ${results.length} jobs` }],
        structuredContent: { rescanned: results.length },
      };
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
          uptime: process.uptime().toFixed(2) + 's'
        };
        
        return {
          content: [{ 
            type: "text", 
            text: `Job Search Service Status:\n\nTotal Jobs: ${totalJobs}\nScanned Jobs: ${scannedJobs}\nMatched Jobs: ${matchedJobs}\nSearch Terms: ${searchTerms.join(', ')}\nLast Update: ${lastUpdate}\nMock Mode: ${status.mockMode ? 'ON' : 'OFF'}\nVersion: ${status.version}\nServer Time: ${status.serverTime}\nUptime: ${status.uptime}`
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
      if (config.mockMode) {
        const mockDataPath = path.join(
          process.cwd(),
          "test/fixtures/linkedin-search-results.json"
        );
        const mockJobs = JSON.parse(await fs.readFile(mockDataPath, "utf8"));
        await updateJobIndex(mockJobs);
        const mockDetailsPath = path.join(
          process.cwd(),
          "test/fixtures/linkedin-job-details.json"
        );
        const mockDetails = JSON.parse(await fs.readFile(mockDetailsPath, "utf8"));
        for (const mockJob of mockDetails) {
          await markJobAsScanned(mockJob.id, {
            matchScore: mockJob.matchScore,
            matchReason: mockJob.matchReason,
            description: mockJob.description,
            requirements: mockJob.requirements,
            salary: mockJob.salary,
            location: mockJob.location,
            scanned: true,
            scanDate: new Date().toISOString(),
          });
        }
        const matches = await getMatchedJobs(0.7);
        await sendDigest(email, matches);
        return {
          content: [
            { type: "text", text: `Sent digest email to ${email} with ${matches.length} mock job matches` },
          ],
          structuredContent: { sent: matches.length, mock: true, email },
        };
      }
      const plan = await getPlan();
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
