import { z } from "zod";

export function getScanTool(agent) {
  return {
    name: "scan",
    description: "Scans LinkedIn job pages. If a URL is provided, scans that page; otherwise scans URLs from the current plan.",
    args: {
      url: z.string().url().optional().describe("An optional LinkedIn job search results page URL to scan."),
      sendDigest: z.boolean().optional().describe("Whether to automatically send a digest email after scan completion (default: true)")
    },
    handler: async ({ url, sendDigest = true }) => {
      const { backgroundJobs, env } = agent;
      if (backgroundJobs.scan.inProgress) {
        return {
          content: [{ type: "text", text: "A scan is already in progress. Please wait for it to complete before starting a new one." }]
        };
      }

      // Initialise scan job state
      backgroundJobs.scan = {
        inProgress: true,
        status: 'queued',
        startTime: new Date().toISOString(),
        endTime: null,
        scannedUrls: [],
        totalJobsFound: 0,
        error: null
      };

      // Determine URLs list for response
      let urlsList;
      if (url) {
        urlsList = [url];
      } else {
        const plan = await env.JOB_STORAGE.get("plan", "json");
        urlsList = plan && plan.searchUrls ? plan.searchUrls.map(u => u.url) : [];
      }

      // Kick off scan in background (don't await)
      agent._runScan(url, { sendDigest });

      return {
        content: [{ type: "text", text: `Scan job started in background. URLs queued:\n${urlsList.join('\n')}\nUse the 'status' tool to check progress.` }],
        structuredContent: { queuedUrls: urlsList }
      };
    },
    options: {
      title: "Scan for LinkedIn Jobs",
      readOnlyHint: false,
      openWorldHint: true
    }
  };
}

export function getRescanTool(agent) {
  return {
    name: "rescan",
    description: "Rescans LinkedIn job pages using the URLs stored in the last scan job (if any) or current plan.",
    args: {
      sendDigest: z.boolean().optional().describe("Whether to automatically send a digest email after rescan completion (default: true)")
    },
    handler: async ({ sendDigest = true }) => {
      const { backgroundJobs } = agent;
      if (backgroundJobs.scan.inProgress) {
        return {
          content: [{ type: "text", text: "A scan is already in progress. Please wait for it to complete before starting a new one." }]
        };
      }
      // Initialize scan job state
      backgroundJobs.scan = {
        inProgress: true,
        status: 'queued',
        startTime: new Date().toISOString(),
        endTime: null,
        scannedUrls: [],
        totalJobsFound: 0,
        error: null
      };
      
      // Determine URLs list
      const plan = await agent.env.JOB_STORAGE.get("plan", "json");
      const urlsList = plan && plan.searchUrls ? plan.searchUrls.map(u => u.url) : [];

      // Kick off scan again with no specific URL to use plan URLs
      agent._runScan(null, { sendDigest });
      return {
        content: [{ type: "text", text: `Rescan started. URLs queued:\n${urlsList.join('\n')}` }],
        structuredContent: { queuedUrls: urlsList }
      };
    },
    options: {
      title: "Rescan LinkedIn Jobs",
      readOnlyHint: false,
      openWorldHint: true
    }
  };
}
