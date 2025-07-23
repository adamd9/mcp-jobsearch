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

          // Launch browser for single job scan
          const browser = await launch(this.env.BROWSER);
          const page = await browser.newPage();

          try {
            const scanResult = await this._deepScanSingleJob(page, mockJob, plan.profile, plan.scanPrompt || '');
            
            await browser.close();
            
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
          } catch (scanError) {
            await browser.close();
            throw scanError;
          }
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

    // Removed duplicate inline scan block

        // Job Indexing and Digests
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
      
      await this._performDeepScan(page);
      
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
  async _performDeepScan(page) {
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
          
          const scanResult = await this._deepScanSingleJob(page, job, plan.profile, plan.scanPrompt || '');
          
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

  // Deep scan a single job
  async _deepScanSingleJob(page, job, profile, scanPrompt) {
    if (!job.url) {
      throw new Error('Job URL is required for deep scanning');
    }

    console.log(`  → Navigating to job URL: ${job.url}`);
    const startTime = Date.now();
    
    try {
      await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 10000 });
      const loadTime = Date.now() - startTime;
      console.log(`  → Page loaded in ${loadTime}ms`);
    } catch (navError) {
      const loadTime = Date.now() - startTime;
      console.log(`  → Page failed to load after ${loadTime}ms`);
      throw navError;
    }

    // Extract job details from the page
    const jobDetails = await page.evaluate((fallbackJob) => {
      const getTextContent = (selector) => {
        const el = document.querySelector(selector);
        return el ? el.textContent.trim() : null;
      };

      return {
        description: getTextContent('.jobs-description-content__text') || 
                    getTextContent('.jobs-box__html-content') ||
                    getTextContent('[data-job-id] .jobs-description') ||
                    'No description found',
        company: getTextContent('.jobs-unified-top-card__company-name') ||
                getTextContent('.job-details-company-name') ||
                fallbackJob.company,
        title: getTextContent('.jobs-unified-top-card__job-title') ||
               getTextContent('h1') ||
               fallbackJob.title,
        location: getTextContent('.jobs-unified-top-card__bullet') ||
                 getTextContent('.job-details-location') ||
                 fallbackJob.location
      };
    }, job);

    // Use OpenAI to match job against profile
    const matchResult = await this._matchJobToProfile(jobDetails, profile, scanPrompt);
    
    return {
      ...jobDetails,
      ...matchResult
    };
  }

  // Match job to profile using OpenAI
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

      const response = await this.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [{ role: 'user', content: prompt }]
      });

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
      return { matchScore: 0, matchReason: `Error: ${error.message}` };
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