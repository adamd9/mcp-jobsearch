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
  mcpServer.tool("get_plan", async () => {
    const plan = await getPlan();
    return {
      content: [{ type: "text", text: JSON.stringify(plan) }],
      structuredContent: plan,
    };
  });

  mcpServer.tool(
    "create_plan",
    z.object({ description: z.string() }),
    async ({ description }) => {
      const plan = await createPlanFromDescription(description);
      return {
        content: [{ type: "text", text: JSON.stringify(plan) }],
        structuredContent: plan,
      };
    }
  );

  mcpServer.tool(
    "update_plan",
    z.record(z.any()),
    async (updates) => {
      const current = await getPlan();
      const updated = { ...current, ...updates };
      await savePlan(updated);
      return {
        content: [{ type: "text", text: JSON.stringify(updated) }],
        structuredContent: updated,
      };
    }
  );

  // Scan jobs without sending digest
  mcpServer.tool("scan", async () => {
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
  });

  // Force rescan all jobs
  mcpServer.tool("rescan", async () => {
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
  });

  // Get jobs with optional filtering
  mcpServer.tool(
    "jobs",
    z
      .object({
        minScore: z.number().optional(),
        scanned: z.boolean().optional(),
        limit: z.number().optional(),
      })
      .partial(),
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
        content: [{ type: "text", text: JSON.stringify(jobs) }],
        structuredContent: jobs,
      };
    }
  );

  // Get a specific job
  mcpServer.tool(
    "job",
    z.object({ id: z.string() }),
    async ({ id }) => {
      const jobIndex = await getJobIndex();
      const job = jobIndex.jobs.find((j) => j.id === id);
      if (!job) {
        return {
          content: [{ type: "text", text: "Job not found" }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(job) }],
        structuredContent: job,
      };
    }
  );

  // Latest matches
  mcpServer.tool("latest_matches", async () => {
    try {
      const matches = await getMatchedJobs(0.7);
      return {
        content: [{ type: "text", text: JSON.stringify(matches) }],
        structuredContent: matches,
      };
    } catch {
      const files = await fs.readdir("data");
      const latest = files.sort().pop();
      const matches = latest
        ? JSON.parse(await fs.readFile(`data/${latest}`))
        : [];
      return {
        content: [{ type: "text", text: JSON.stringify(matches) }],
        structuredContent: matches,
      };
    }
  });

  // Send digest email
  mcpServer.tool(
    "send_digest",
    z.object({ email: z.string() }),
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
            { type: "text", text: `Sent ${matches.length} mock matches` },
          ],
          structuredContent: { sent: matches.length, mock: true },
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
        content: [{ type: "text", text: `Sent ${matches.length} matches` }],
        structuredContent: { sent: matches.length },
      };
    }
  );

  return mcpServer.server;
}
