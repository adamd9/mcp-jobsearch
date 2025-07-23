import { z } from "zod";

export function getScanTool(agent) {
  return {
    name: "scan",
    description: "Scans LinkedIn job pages. If a URL is provided, scans that page; otherwise scans URLs from the current plan.",
    args: {
      url: z.string().url().optional().describe("An optional LinkedIn job search results page URL to scan.")
    },
    handler: async ({ url }) => {
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

      // Kick off scan in background (don't await)
      agent._runScan(url);

      return {
        content: [{ type: "text", text: "Scan job started in the background. Use the 'status' tool to check progress." }]
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
    args: {},
    handler: async () => {
      const { backgroundJobs } = agent;
      if (backgroundJobs.scan.inProgress) {
        return {
          content: [{ type: "text", text: "A scan is already in progress. Please wait for it to complete before starting a new one." }]
        };
      }
      // Kick off scan again with no specific URL to use plan URLs
      backgroundJobs.scan = {
        inProgress: true,
        status: 'queued',
        startTime: new Date().toISOString(),
        endTime: null,
        scannedUrls: [],
        totalJobsFound: 0,
        error: null
      };
      agent._runScan();
      return {
        content: [{ type: "text", text: "Rescan started in background." }]
      };
    },
    options: {
      title: "Rescan LinkedIn Jobs",
      readOnlyHint: false,
      openWorldHint: true
    }
  };
}
