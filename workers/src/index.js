import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import OpenAI from "openai";

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

	openai = null;

	async init() {
		this.openai = new OpenAI({
			apiKey: this.env.OPENAI_API_KEY,
		});

		// Plan tools
		this.server.tool(
			"get_plan",
			"Get the current job search plan",
			async () => {
				const plan = await this.env.JOB_STORAGE.get("plan", "json");
				if (!plan) {
					return {
						content: [{ type: "text", text: "No plan found." }],
						structuredContent: { 
							profile: '', 
							searchTerms: [], 
							locations: [],
							scanPrompt: '',
							searchUrls: []
						},
					};
				}

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
				const prompt = `Convert the following description into a JSON job search plan with these fields:
- "profile": A concise summary of the job seeker's profile
- "searchTerms": Array of search terms/keywords (each item should be a complete search query)
- "locations": Array of location objects, each with:
  - "name": Location name (city, state, country)
  - "geoId": LinkedIn geographic ID if known (optional)
  - "type": "city", "country", or "remote"
  - "distance": Search radius in miles (for city searches, optional)
- "scanPrompt": Instructions for evaluating job matches

Description:
${description}

Respond with ONLY the JSON object. No additional text.`;

				console.log("--- AI PROMPT ---");
				console.log(prompt);

				const aiResponse = await this.openai.chat.completions.create({
					model: this.env.OPENAI_MODEL || 'gpt-4.1-mini',
					messages: [
						{ role: 'system', content: 'You create structured job search plans.' },
						{ role: 'user', content: prompt }
					],
					temperature: 0.2
				});

				const content = aiResponse.choices[0].message.content;
				console.log("--- AI RAW RESPONSE ---");
				console.log(content);

				const jsonMatch = content.match(/\{[\s\S]*\}/);
				let plan;
				try {
					plan = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
					console.log("--- PARSED PLAN ---");
					console.log(JSON.stringify(plan, null, 2));
				} catch (e) {
					console.error("--- JSON PARSE ERROR ---", e);
					plan = {};
				}

				plan.profile = plan.profile || description;
				plan.searchTerms = plan.searchTerms || [];
				plan.locations = plan.locations || [];
				plan.scanPrompt = plan.scanPrompt || description;

				plan.searchUrls = this._generateSearchUrls(plan.searchTerms, plan.locations);
				plan.feedback = await this._generatePlanFeedback(plan);

				await this.env.JOB_STORAGE.put("plan", JSON.stringify(plan));

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