import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

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

// Define our MCP agent with tools
export class JobSearchMCP extends McpAgent {
	server = new McpServer({
		name: "JobSearch MCP",
		version: "1.0.0",
	});

	async init() {
		// Add authentication handler to MCP server
		// Note: This will be implemented in the next phase
		
		// Plan tools
		this.server.tool(
			"get_plan",
			"Get the current job search plan",
			async () => {
				// Stub implementation
				const plan = { 
					searchTerms: ["software engineer", "frontend developer"],
					searchUrls: [
						{ url: "https://www.linkedin.com/jobs/search/?keywords=software%20engineer", term: "software engineer", location: "remote" }
					],
					profile: "Stub profile text",
					scanPrompt: "Stub scan prompt"
				};
				
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

		this.server.tool(
			"create_plan",
			"Create a new job search plan from a description",
			{
				description: z.string().describe("Description of the job search plan")
			},
			async ({ description }) => {
				// Stub implementation
				const plan = {
					searchTerms: ["software engineer", "frontend developer"],
					searchUrls: [
						{ url: "https://www.linkedin.com/jobs/search/?keywords=software%20engineer", term: "software engineer", location: "remote" }
					],
					profile: "Generated from: " + description,
					scanPrompt: "Default scan prompt"
				};
				
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

		this.server.tool(
			"update_plan",
			"Update the existing job search plan with new values",
			z.union([
				z.object({
					description: z.string().describe("Natural language description of the changes to make to the plan")
				}),
				z.record(z.any()).describe("Fields to update in the job search plan")
			]),
			async (input) => {
				// Stub implementation
				const updated = {
					searchTerms: ["software engineer", "frontend developer", "react developer"],
					searchUrls: [
						{ url: "https://www.linkedin.com/jobs/search/?keywords=software%20engineer", term: "software engineer", location: "remote" },
						{ url: "https://www.linkedin.com/jobs/search/?keywords=react%20developer", term: "react developer", location: "remote" }
					],
					profile: "Updated profile text",
					scanPrompt: "Updated scan prompt"
				};
				
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
		this.server.tool(
			"scan",
			"Scan LinkedIn for jobs based on search terms in the plan. Can optionally send an email digest of new job matches after scanning completes. Can also disable deep scanning of job details.",
			{
				sendDigest: z.boolean().optional().describe('Send email digest after scan completes (default: true if SMTP configured)'),
				deepScan: z.boolean().optional().describe('Perform deep scanning of job details (default: true)')
			},
			async ({ sendDigest, deepScan = true }) => {
				// Stub implementation
				// Reset scan job status
				backgroundJobs.scan = {
					inProgress: true,
					startTime: Date.now(),
					endTime: null,
					status: 'running',
					totalJobs: 10,
					scannedJobs: 0,
					error: null
				};
				
				// Simulate background job
				setTimeout(() => {
					backgroundJobs.scan.status = 'completed';
					backgroundJobs.scan.endTime = Date.now();
					backgroundJobs.scan.inProgress = false;
					backgroundJobs.scan.scannedJobs = 10;
				}, 1000);
				
				// Return immediately with job started status
				const structuredResult = { 
					jobStarted: true,
					mockMode: false,
					jobType: 'scan'
				};
				
				return {
					content: [
						{ 
							type: "text", 
							text: `Scan job started in the background. Use the 'status' tool to check progress.` 
						},
						{
							type: "text",
							text: JSON.stringify(structuredResult, null, 2)
						}
					],
					structuredContent: structuredResult,
				};
			},
			{
				title: "Scan LinkedIn Jobs",
				readOnlyHint: false,
				openWorldHint: false
			}
		);

		// Force rescan all jobs
		this.server.tool(
			"rescan",
			"Rescan existing jobs in the index. Can optionally send an email digest of new job matches after scanning completes. Can also disable deep scanning of job details.",
			{
				sendDigest: z.boolean().optional().describe('Send email digest after rescan completes (default: true if SMTP configured)'),
				deepScan: z.boolean().optional().describe('Perform deep scanning of job details (default: true)')
			},
			async ({ sendDigest, deepScan = true }) => {
				// Stub implementation
				// Reset rescan job status
				backgroundJobs.rescan = {
					inProgress: true,
					startTime: Date.now(),
					endTime: null,
					status: 'running',
					totalJobs: 5,
					scannedJobs: 0,
					error: null
				};
				
				// Simulate background job
				setTimeout(() => {
					backgroundJobs.rescan.status = 'completed';
					backgroundJobs.rescan.endTime = Date.now();
					backgroundJobs.rescan.inProgress = false;
					backgroundJobs.rescan.scannedJobs = 5;
				}, 1000);
				
				// Return immediately with job started status
				const structuredResult = { 
					jobStarted: true,
					mockMode: false,
					jobType: 'rescan'
				};
				
				return {
					content: [
						{ 
							type: "text", 
							text: `Rescan job started in the background. Use the 'status' tool to check progress.` 
						},
						{
							type: "text",
							text: JSON.stringify(structuredResult, null, 2)
						}
					],
					structuredContent: structuredResult,
				};
			},
			{
				title: "Rescan All Jobs",
				readOnlyHint: false,
				openWorldHint: false
			}
		);

		// Get jobs with optional filtering
		this.server.tool(
			"jobs",
			"Get jobs from the index with optional filtering",
			{
				minScore: z.number().optional().describe("Minimum match score (0-1)"),
				scanned: z.boolean().optional().describe("Filter by scan status"),
				limit: z.number().optional().describe("Maximum number of jobs to return"),
			},
			async ({ minScore, scanned, limit }) => {
				// Stub implementation
				const jobs = [
					{
						id: "job1",
						title: "Software Engineer",
						company: "Example Corp",
						location: "Remote",
						url: "https://example.com/job1",
						matchScore: 0.85,
						scanned: true
					},
					{
						id: "job2",
						title: "Frontend Developer",
						company: "Tech Inc",
						location: "San Francisco, CA",
						url: "https://example.com/job2",
						matchScore: 0.75,
						scanned: true
					}
				];
				
				return {
					content: [
						{ 
							type: "text", 
							text: `Found ${jobs.length} jobs${minScore ? ` with score >= ${minScore}` : ''}${typeof scanned !== "undefined" ? ` (${scanned ? 'scanned' : 'not scanned'})` : ''}` 
						},
						{
							type: "text",
							text: JSON.stringify({ jobs }, null, 2)
						}
					],
					structuredContent: { jobs },
				};
			},
			{
				title: "Get Jobs",
				readOnlyHint: true,
				openWorldHint: false
			}
		);

		// Status endpoint - Get current status of the job search service
		this.server.tool(
			"status",
			"Get the current status of the job search service",
			{},
			async () => {
				// Stub implementation
				const status = {
					totalJobs: 10,
					scannedJobs: 8,
					matchedJobs: 5,
					searchTerms: ["software engineer", "frontend developer"],
					lastUpdate: new Date().toISOString(),
					mockMode: false,
					version: '1.0.0',
					serverTime: new Date().toISOString(),
					uptime: '120s',
					// Add background job status
					backgroundJobs: {
						scan: { ...backgroundJobs.scan },
						rescan: { ...backgroundJobs.rescan }
					}
				};
				
				// Build status text
				let statusText = `Job Search Service Status:\n\nTotal Jobs: ${status.totalJobs}\nScanned Jobs: ${status.scannedJobs}\nMatched Jobs: ${status.matchedJobs}\nSearch Terms: ${status.searchTerms.join(', ')}\nLast Update: ${status.lastUpdate}\nMock Mode: ${status.mockMode ? 'ON' : 'OFF'}\nVersion: ${status.version}\nServer Time: ${status.serverTime}\nUptime: ${status.uptime}`;
				
				return {
					content: [
						{ 
							type: "text", 
							text: statusText
						},
						{
							type: "text",
							text: JSON.stringify(status, null, 2)
						}
					],
					structuredContent: status,
				};
			},
			{
				title: "Service Status",
				readOnlyHint: true,
				openWorldHint: false
			}
		);

		// Reset job index
		this.server.tool(
			"reset_job_index",
			"Reset the job index to start fresh",
			{},
			async () => {
				// Stub implementation
				return {
					content: [{ type: "text", text: "Job index has been reset successfully. All jobs have been removed." }],
					structuredContent: { success: true },
				};
			},
			{
				title: "Reset Job Index",
				readOnlyHint: false,
				openWorldHint: false
			}
		);

		// Send digest email
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
}

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);

		if (url.pathname === "/sse" || url.pathname === "/sse/message") {
			return JobSearchMCP.serveSSE("/sse").fetch(request, env, ctx);
		}

		if (url.pathname === "/mcp") {
			return JobSearchMCP.serve("/mcp").fetch(request, env, ctx);
		}

		// Add a simple health check endpoint
		if (url.pathname === "/health") {
			return new Response(JSON.stringify({ status: "ok" }), { 
				status: 200,
				headers: { "Content-Type": "application/json" }
			});
		}

		return new Response("Not found", { status: 404 });
	},
};