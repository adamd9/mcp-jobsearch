import * as cheerio from 'cheerio';

// HTTP-based deep scan implementation - more efficient than Playwright/Puppeteer
export async function httpDeepScanSingleJob(agent, job, profile, scanPrompt) {
  if (!job.url) {
    throw new Error('Job URL is required for deep scanning');
  }

  console.log(`  → Fetching job URL via HTTP: ${job.url}`);
  const startTime = Date.now();
  
  try {
    // Fetch the job page with browser-like headers
    const response = await fetch(job.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'max-age=0'
      },
      // Add timeout to prevent hanging
      signal: AbortSignal.timeout(30000) // 30 second timeout
    });

    const fetchTime = Date.now() - startTime;
    console.log(`  → HTTP fetch completed in ${fetchTime}ms, status: ${response.status}`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Parse HTML content
    const html = await response.text();
    const $ = cheerio.load(html);
    
    // Extract page content similar to how Playwright does it
    const pageContent = {
      title: $('title').text() || '',
      url: job.url,
      fullContent: extractJobContent($)
    };

    console.log(`  → Extracted ${pageContent.fullContent.length} characters of content via HTTP`);

    // Validate that we got meaningful job content
    if (pageContent.fullContent.length < 500) {
      console.log(`  ⚠️  Warning: Very little content extracted (${pageContent.fullContent.length} chars), may need JavaScript rendering`);
    }

    // Check for job-related content to ensure we got the right page
    const hasJobKeywords = /job|position|role|responsibilities|requirements|qualifications|description/i.test(pageContent.fullContent);
    if (!hasJobKeywords) {
      console.log(`  ⚠️  Warning: No job-related keywords found in content, may be blocked or redirected`);
    }

    // Send full page content to LLM for extraction and matching
    const analysisResult = await analyzeJobPageWithLLM(agent, pageContent, job, profile, scanPrompt);
    
    console.log(`  → HTTP-based deep scan completed for ${job.url}, match score: ${analysisResult.matchScore}`);
    return analysisResult;

  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.log(`  → HTTP fetch failed after ${totalTime}ms: ${error.message}`);
    
    // Log additional error details for debugging
    if (error.name === 'AbortError') {
      console.log(`  → Request timed out after 30 seconds`);
    } else if (error.message.includes('HTTP')) {
      console.log(`  → Server returned error response`);
    } else {
      console.log(`  → Network or parsing error`);
    }
    
    throw error;
  }
}

// Extract meaningful job content from the parsed HTML
function extractJobContent($) {
  // Remove script and style elements
  $('script, style, noscript').remove();
  
  // Try to get the main body text, similar to document.body.innerText
  let fullContent = $('body').text();
  
  // Clean up the text - remove excessive whitespace
  fullContent = fullContent
    .replace(/\s+/g, ' ')  // Replace multiple whitespace with single space
    .replace(/\n\s*\n/g, '\n')  // Remove empty lines
    .trim();
  
  return fullContent;
}

// Analyze full job page content with LLM
export async function analyzeJobPageWithLLM(agent, pageContent, job, profile, scanPrompt) {
  const prompt = `You are a job analysis system. Analyze the LinkedIn job page content and respond with ONLY a JSON object, no other text.

Candidate Profile:
${profile}

Additional Criteria:
${scanPrompt || 'None'}

Job Page Content:
${pageContent.fullContent.substring(0, 8000)}

Extract job details and provide a match score from 0.0 to 1.0.

Respond with ONLY this JSON format (no additional text):
{
  "title": "extracted job title",
  "company": "extracted company name",
  "location": "extracted location",
  "description": "extracted job description",
  "salary": "extracted salary or null",
  "matchScore": 0.8,
  "matchReason": "detailed explanation of match"
}`;

  // Use OpenAI for analysis
  try {
    console.log(`  → Analyzing full page with OpenAI...`);
    const response = await agent.openai.chat.completions.create({
      model: agent.env.OPENAI_MODEL || 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 1000
    });
    console.log(`  → OpenAI analysis complete`);

    try {
      // Clean and parse the response
      let cleanResponse = response.choices[0].message.content
        .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .trim();
      
      // Try to extract JSON from the response - look for complete JSON objects
      let jsonMatch = cleanResponse.match(/\{[\s\S]*?"matchScore"[\s\S]*?\}/i);
      if (!jsonMatch) {
        // Try broader JSON pattern
        jsonMatch = cleanResponse.match(/\{[\s\S]*\}/i);
      }
      if (jsonMatch) {
        cleanResponse = jsonMatch[0];
      } else {
        // If no JSON found, log the response and try to extract key info
        console.log(`  → No JSON found in response: ${cleanResponse.substring(0, 200)}...`);
        throw new Error('No JSON structure found in AI response');
      }
      
      console.log(`  → Extracted JSON: ${cleanResponse.substring(0, 200)}...`);
      
      const result = JSON.parse(cleanResponse);
      
      const analysisResult = {
        title: result.title || job.title,
        company: result.company || job.company,
        location: result.location || job.location,
        description: result.description || 'No description extracted',
        salary: result.salary || null,
        matchScore: Math.max(0, Math.min(1, result.matchScore || 0)),
        matchReason: result.matchReason || 'No reason provided'
      };
      
      console.log(`  → AI analysis result prepared: ${analysisResult.title} at ${analysisResult.company}`);
      return analysisResult;
      
    } catch (parseError) {
      console.error('Error parsing OpenAI analysis:', parseError);
      console.log(`  → Falling back to keyword matching due to parse error`);
      return fallbackJobMatching({ 
        title: job.title,
        company: job.company,
        location: job.location,
        description: pageContent.fullContent.substring(0, 2000)
      }, profile, scanPrompt);
    }
    
  } catch (aiError) {
    console.log(`  → OpenAI analysis failed: ${aiError.message}`);
    console.log(`  → Using fallback keyword matching...`);
    return fallbackJobMatching({ 
      title: job.title,
      company: job.company,
      location: job.location,
      description: pageContent.fullContent.substring(0, 2000)
    }, profile, scanPrompt);
  }
}

// Fallback keyword matching when AI is unavailable
export function fallbackJobMatching(jobDetails, profile, scanPrompt) {
  try {
    console.log(`  → Running fallback keyword matching...`);
    
    const jobText = `${jobDetails.title} ${jobDetails.company} ${jobDetails.location} ${jobDetails.description}`.toLowerCase();
    const profileText = `${profile} ${scanPrompt}`.toLowerCase();
    
    // Extract keywords from profile
    const profileKeywords = profileText.match(/\b\w{3,}\b/g) || [];
    const uniqueKeywords = [...new Set(profileKeywords)];
    
    // Score based on keyword matches
    let matchCount = 0;
    let totalKeywords = Math.min(uniqueKeywords.length, 20); // Limit to top 20 keywords
    
    const matchedKeywords = [];
    
    for (const keyword of uniqueKeywords.slice(0, 20)) {
      if (jobText.includes(keyword)) {
        matchCount++;
        matchedKeywords.push(keyword);
      }
    }
    
    // Bonus scoring for important terms
    const bonusTerms = ['engineer', 'software', 'mechanical', 'new york', 'nyc', 'remote'];
    let bonusScore = 0;
    
    for (const term of bonusTerms) {
      if (jobText.includes(term) && profileText.includes(term)) {
        bonusScore += 0.1;
      }
    }
    
    // Calculate final score
    const baseScore = totalKeywords > 0 ? matchCount / totalKeywords : 0;
    const finalScore = Math.min(1.0, baseScore + bonusScore);
    
    const reason = `Keyword matching: ${matchCount}/${totalKeywords} keywords matched. ` +
                  `Matched terms: ${matchedKeywords.slice(0, 5).join(', ')}${matchedKeywords.length > 5 ? '...' : ''}. ` +
                  `Bonus score: +${bonusScore.toFixed(1)} for important terms.`;
    
    console.log(`  → Fallback match score: ${finalScore.toFixed(2)}`);
    
    return {
      matchScore: Math.round(finalScore * 100) / 100, // Round to 2 decimals
      matchReason: reason
    };
    
  } catch (error) {
    console.error('Error in fallback matching:', error);
    return {
      matchScore: 0.5, // Default neutral score
      matchReason: 'Fallback matching failed, assigned neutral score'
    };
  }
}

// HTTP-based version of performDeepScan that doesn't need browser management
export async function httpPerformDeepScan(agent) {
  try {
    // Get jobs that need deep scanning
    const jobIndex = await agent.env.JOB_STORAGE.get('job_index', 'json');
    if (!jobIndex || !jobIndex.jobs) {
      console.log('No jobs found for deep scanning');
      return;
    }

    const jobsToScan = jobIndex.jobs.filter(job => !job.scanned);
    console.log(`Found ${jobsToScan.length} jobs to deep scan via HTTP`);
    
    if (jobsToScan.length === 0) {
      return;
    }

    // Get plan for profile and scan prompt
    const plan = await agent.env.JOB_STORAGE.get('plan', 'json');
    if (!plan || !plan.profile) {
      console.log('No profile found in plan for deep scanning');
      return;
    }

    // Limit deep scan to avoid timeouts (max 10 jobs)
    const limitedJobs = jobsToScan.slice(0, 10);
    console.log(`HTTP deep scanning ${limitedJobs.length} jobs (no browser needed)...`);
    
    // Initialize progress tracking
    agent.backgroundJobs.scan.deepScanProgress = {
      total: limitedJobs.length,
      completed: 0,
      current: null,
      errors: 0
    };

    // Process jobs sequentially using HTTP requests
    for (let i = 0; i < limitedJobs.length; i++) {
      const job = limitedJobs[i];
      
      // Check for cancellation before each job
      if (agent.backgroundJobs.scan.cancelled) {
        console.log('Deep scan cancelled by user');
        agent.backgroundJobs.scan.status = 'cancelled';
        break;
      }
      
      // Update progress tracking
      agent.backgroundJobs.scan.deepScanProgress.current = {
        index: i + 1,
        title: job.title,
        company: job.company,
        url: job.url
      };
      
      try {
        console.log(`HTTP deep scanning job ${i + 1}/${limitedJobs.length}: ${job.title} at ${job.company}`);
        
        const scanResult = await httpDeepScanSingleJob(agent, job, plan.profile, plan.scanPrompt || '');
        
        // Update job with scan results
        job.scanned = true;
        job.scanDate = new Date().toISOString();
        job.matchScore = scanResult.matchScore || 0;
        job.matchReason = scanResult.matchReason || '';
        job.description = scanResult.description || job.description;
        job.requirements = scanResult.requirements || [];
        job.salary = scanResult.salary || null;
        job.scanStatus = 'completed';
        
        agent.backgroundJobs.scan.deepScanProgress.completed++;
        console.log(`✓ HTTP job scan complete. Match score: ${job.matchScore}`);
        
      } catch (jobError) {
        console.error(`✗ Error in HTTP scan for job ${job.id} (${job.title}):`, jobError.message);
        
        // Check if error was due to cancellation
        if (jobError.message.includes('cancelled')) {
          console.log('HTTP deep scan cancelled during job processing');
          agent.backgroundJobs.scan.status = 'cancelled';
          break;
        }
        
        // Mark job as scanned but with error details
        job.scanned = true;
        job.scanDate = new Date().toISOString();
        job.matchScore = 0;
        job.matchReason = 'HTTP scan failed due to error';
        job.scanStatus = 'error';
        job.scanError = {
          type: jobError.name || 'Error',
          message: jobError.message,
          timestamp: new Date().toISOString()
        };
        
        // Log specific error types for debugging
        if (jobError.name === 'AbortError') {
          console.log(`  → HTTP request timeout (likely slow response)`);
          job.scanError.reason = 'http_timeout';
        } else if (jobError.message.includes('HTTP')) {
          console.log(`  → HTTP error response from server`);
          job.scanError.reason = 'http_error';
        } else {
          job.scanError.reason = 'unknown';
        }
        
        agent.backgroundJobs.scan.deepScanProgress.errors++;
        console.log(`  → Continuing with next job...`);
      }
    }

    // Save updated job index with scan statistics
    const completedJobs = limitedJobs.filter(j => j.scanStatus === 'completed').length;
    const errorJobs = limitedJobs.filter(j => j.scanStatus === 'error').length;
    
    await agent.env.JOB_STORAGE.put('job_index', JSON.stringify(jobIndex));
    
    console.log(`HTTP deep scan phase completed:`);
    console.log(`  ✓ Successfully scanned: ${completedJobs} jobs`);
    console.log(`  ✗ Failed to scan: ${errorJobs} jobs`);
    console.log(`  📊 Total processing time saved by avoiding browser overhead`);
    
  } catch (error) {
    console.error('HTTP deep scan failed:', error.message);
    throw error;
  }
}
