import { z } from "zod";
import { runScan } from './scan-helpers.js';
import { TOOL_DESCRIPTIONS, TOOL_ARGS, TOOL_ERRORS } from './tool-descriptions.js';

export function getScanTool(agent) {
  return {
    name: "scan",
    description: TOOL_DESCRIPTIONS.SCAN,
    args: {
      url: z.string().url().optional().describe(TOOL_ARGS.SCAN_URL),
      skipDigest: z.boolean().optional().describe(TOOL_ARGS.SCAN_SKIP_DIGEST)
    },
    handler: async ({ url, skipDigest = false }) => {
      const sendDigest = !skipDigest;
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
        error: null,
        cancelled: false,
        deepScanProgress: null
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
      runScan(agent, url, { sendDigest });

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
    description: TOOL_DESCRIPTIONS.RESCAN,
    args: {
      skipDigest: z.boolean().optional().describe("Skip sending digest email after rescan completion")
    },
    handler: async ({ skipDigest = false }) => {
      const sendDigest = !skipDigest;
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
        error: null,
        cancelled: false,
        deepScanProgress: null
      };
      
      // Determine URLs list
      const plan = await agent.env.JOB_STORAGE.get("plan", "json");
      const urlsList = plan && plan.searchUrls ? plan.searchUrls.map(u => u.url) : [];

      // Kick off scan again with no specific URL to use plan URLs
      runScan(agent, null, { sendDigest });
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
