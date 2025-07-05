import Fastify from "fastify";
import { fastifyMCPSSE } from "fastify-mcp";
import fastifyCron from "fastify-cron";
import { scrapeLinkedIn } from "./scrape.js";
import { sendDigest } from "./mailer.js";
import { getJobIndex, getMatchedJobs, getJobsToScan, updateJobIndex } from "./storage.js";
import { deepScanJobs } from "./deep-scan.js";
import { loadConfig } from "./config.js";
import { getPlan, savePlan, createPlanFromDescription } from "./plan.js";
import fs from "fs/promises";
import path from "path";

const app = Fastify();

// Use top-level await inside an async IIFE
const start = async () => {
  // Load configuration from file and environment variables
  const config = await loadConfig();
  console.log(`Starting server with mockMode: ${config.mockMode}`);
  
  await app.register(fastifyMCPSSE);
  await app.register(fastifyCron, {
  jobs: [{
    cronTime: "0 7 * * *",        // 07:00 every day
    start: true,
    onTick: async () => {
      const plan = await getPlan();
      for (const term of plan.searchTerms) {
        const url = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(term)}`;
        await scrapeLinkedIn(url, { deepScan: true, profileText: plan.profile, scanPrompt: plan.scanPrompt });
      }
      const matches = await getMatchedJobs(0.7);
      await saveMatches(matches);
      await sendDigest(process.env.DIGEST_TO, matches);
    },
    timeZone: process.env.TIMEZONE
  }]
});

  // Plan endpoints
  app.get('/plan', async () => {
    return getPlan();
  });

  app.post('/plan', async (req, reply) => {
    try {
      const description = req.body.description;
      if (!description) {
        reply.status(400).send({ error: 'description required' });
        return;
      }
      const plan = await createPlanFromDescription(description);
      reply.send(plan);
    } catch (error) {
      reply.status(500).send({ error: error.message });
    }
  });

  app.put('/plan', async (req, reply) => {
    try {
      const current = await getPlan();
      const updated = { ...current, ...req.body };
      await savePlan(updated);
      reply.send(updated);
    } catch (error) {
      reply.status(500).send({ error: error.message });
    }
  });

// MCP resource - Get latest matches from job index
app.get("/latest_matches", async () => {
  try {
    // Get matched jobs with score >= 0.7
    const matches = await getMatchedJobs(0.7);
    return matches;
  } catch (error) {
    console.error(`Error getting latest matches: ${error.message}`);
    // Fall back to file-based matches if job index fails
    const files = await fs.readdir("data");
    const latest = files.sort().pop();
    return latest ? JSON.parse(await fs.readFile(`data/${latest}`)) : [];
  }
});

// MCP tool - Send digest email
app.post("/send_digest", async (req, reply) => {
  const to = req.body.email;
  try {
    // Get current configuration
    const config = await loadConfig();
    
    // Check if using mock data
    if (config.mockMode) {
      console.log('Using mock data for digest');
      
      // Load mock search results
      const mockDataPath = path.join(process.cwd(), 'test/fixtures/linkedin-search-results.json');
      const mockJobs = JSON.parse(await fs.readFile(mockDataPath, 'utf8'));
      
      // Update job index with mock data
      await updateJobIndex(mockJobs);
      
      // Load mock job details
      const mockDetailsPath = path.join(process.cwd(), 'test/fixtures/linkedin-job-details.json');
      const mockDetails = JSON.parse(await fs.readFile(mockDetailsPath, 'utf8'));
      
      // Update each job with mock scan results
      for (const mockJob of mockDetails) {
        await markJobAsScanned(mockJob.id, {
          matchScore: mockJob.matchScore,
          matchReason: mockJob.matchReason,
          description: mockJob.description,
          requirements: mockJob.requirements,
          salary: mockJob.salary,
          location: mockJob.location,
          scanned: true,
          scanDate: new Date().toISOString()
        });
      }
      
      // Get matched jobs from index
      const matches = await getMatchedJobs(0.7);
      
      // Save matches to daily file for backward compatibility
      await saveMatches(matches);
      
      // Send digest email
      await sendDigest(to, matches);
      
      reply.send({ sent: matches.length, mock: true });
      return;
    }
    
    // Use real scraping and deep scan based on plan
    const plan = await getPlan();
    for (const term of plan.searchTerms) {
      const url = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(term)}`;
      await scrapeLinkedIn(url, { deepScan: true, profileText: plan.profile, scanPrompt: plan.scanPrompt });
    }
    
    // Get matched jobs from index
    const matches = await getMatchedJobs(0.7);
    
    // Save matches to daily file for backward compatibility
    await saveMatches(matches);
    
    // Send digest email
    await sendDigest(to || config.digestTo, matches);
    
    reply.send({ sent: matches.length });
  } catch (error) {
    console.error(`Error sending digest: ${error.message}`);
    reply.status(500).send({ error: error.message });
  }
});

// MCP tool - Scan without sending digest
app.get("/scan", async (req, reply) => {
  try {
    // Get current configuration
    const config = await loadConfig();
    
    // Check if using mock data
    if (config.mockMode) {
      console.log('Using mock data for scan');
      
      // Load mock data
      const mockDataPath = path.join(process.cwd(), 'test/fixtures/linkedin-search-results.json');
      const mockJobs = JSON.parse(await fs.readFile(mockDataPath, 'utf8'));
      
      // Update job index with mock data
      await updateJobIndex(mockJobs);
      
      reply.send({ scanned: mockJobs.length, mock: true });
      return;
    }
    
    // Use real scraping based on plan
    const plan = await getPlan();
    let total = 0;
    for (const term of plan.searchTerms) {
      const url = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(term)}`;
      const { jobs } = await scrapeLinkedIn(url);
      total += jobs.length;
    }

    reply.send({ scanned: total });
  } catch (error) {
    console.error(`Error scanning: ${error.message}`);
    reply.status(500).send({ error: error.message });
  }
});

// MCP tool - Force rescan of all jobs in the index
app.post("/rescan", async (req, reply) => {
  try {
    // Get current configuration
    const config = await loadConfig();
    
    // Check if using mock data
    if (config.mockMode) {
      console.log('Using mock data for rescan');
      
      // Load mock job details
      const mockDetailsPath = path.join(process.cwd(), 'test/fixtures/linkedin-job-details.json');
      const mockDetails = JSON.parse(await fs.readFile(mockDetailsPath, 'utf8'));
      
      // Update each job with mock scan results
      for (const mockJob of mockDetails) {
        await markJobAsScanned(mockJob.id, {
          matchScore: mockJob.matchScore,
          matchReason: mockJob.matchReason,
          description: mockJob.description,
          requirements: mockJob.requirements,
          salary: mockJob.salary,
          location: mockJob.location,
          scanned: true,
          scanDate: new Date().toISOString()
        });
      }
      
      reply.send({ rescanned: mockDetails.length, mock: true });
      return;
    }
    
    // Get all jobs from index
    const jobs = await getJobIndex();

    const plan = await getPlan();
    const profile = plan.profile || await fs.readFile(path.join(process.cwd(), 'profile.txt'), 'utf8');

    // Force rescan all jobs
    const results = await deepScanJobs(jobs, profile, config.deepScanConcurrency, plan.scanPrompt);
    
    reply.send({ rescanned: results.length });
  } catch (error) {
    console.error(`Error rescanning: ${error.message}`);
    reply.status(500).send({ error: error.message });
  }
});

// MCP resource - Get all jobs with optional filtering
app.get("/jobs", async (req, reply) => {
  try {
    const jobIndex = await getJobIndex();
    const { minScore, scanned, limit } = req.query;
    
    let jobs = jobIndex.jobs;
    
    // Apply filters if provided
    if (minScore !== undefined) {
      const scoreThreshold = parseFloat(minScore);
      jobs = jobs.filter(job => job.matchScore >= scoreThreshold);
    }
    
    if (scanned !== undefined) {
      const isScanned = scanned === 'true';
      jobs = jobs.filter(job => job.scanned === isScanned);
    }
    
    // Apply limit if provided
    if (limit !== undefined) {
      const limitNum = parseInt(limit);
      jobs = jobs.slice(0, limitNum);
    }
    
    return jobs;
  } catch (error) {
    console.error(`Error getting jobs: ${error.message}`);
    reply.status(500).send({ error: error.message });
  }
});

// MCP resource - Get details for a specific job
app.get("/job/:id", async (req, reply) => {
  try {
    const jobIndex = await getJobIndex();
    const job = jobIndex.jobs.find(j => j.id === req.params.id);
    
    if (!job) {
      reply.status(404).send({ error: 'Job not found' });
      return;
    }
    
    return job;
  } catch (error) {
    console.error(`Error getting job: ${error.message}`);
    reply.status(500).send({ error: error.message });
  }
});

  await app.listen({ port: 8000, host: "0.0.0.0" });
  console.log('Server started on http://localhost:8000');
};

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
