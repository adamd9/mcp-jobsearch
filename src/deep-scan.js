// Deep scan a single job
export async function deepScanSingleJob(agent, page, job, profile, scanPrompt) {
  if (!job.url) {
    throw new Error('Job URL is required for deep scanning');
  }

  console.log(`  → Navigating to job URL: ${job.url}`);
  const startTime = Date.now();
  
  try {
    // Try with longer timeout and wait for JavaScript to settle
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    
    // Wait for LinkedIn's dynamic content to load
    await page.waitForTimeout(3000);
    
    const loadTime = Date.now() - startTime;
    console.log(`  → Page loaded in ${loadTime}ms`);
  } catch (navError) {
    const loadTime = Date.now() - startTime;
    console.log(`  → Page failed to load after ${loadTime}ms`);
    
    // Try one more time with networkidle strategy
    try {
      console.log(`  → Retrying with networkidle strategy...`);
      await page.goto(job.url, { waitUntil: 'networkidle', timeout: 15000 });
      const retryTime = Date.now() - startTime;
      console.log(`  → Page loaded on retry in ${retryTime}ms`);
    } catch (retryError) {
      const finalTime = Date.now() - startTime;
      console.log(`  → Final attempt failed after ${finalTime}ms`);
      
      // Log DOM snapshot for debugging
      try {
        const currentUrl = page.url();
        const pageTitle = await page.title().catch(() => 'Unable to get title');
        const bodyText = await page.evaluate(() => {
          return document.body ? document.body.innerText.substring(0, 500) : 'No body content';
        }).catch(() => 'Unable to get body text');
        
        console.log(`  → DOM Snapshot for failed job ${job.id}:`);
        console.log(`     Current URL: ${currentUrl}`);
        console.log(`     Page Title: ${pageTitle}`);
        console.log(`     Body Text (first 500 chars): ${bodyText}`);
        
        // Check for common LinkedIn error indicators
        const hasLoginForm = await page.$('form[data-id="sign-in-form"]').catch(() => null);
        const hasErrorMessage = await page.$('.error-message, .not-found').catch(() => null);
        const hasJobContent = await page.$('.jobs-unified-top-card, .job-details').catch(() => null);
        
        console.log(`     Has Login Form: ${!!hasLoginForm}`);
        console.log(`     Has Error Message: ${!!hasErrorMessage}`);
        console.log(`     Has Job Content: ${!!hasJobContent}`);
        
      } catch (snapshotError) {
        console.log(`  → Failed to capture DOM snapshot: ${snapshotError.message}`);
      }
      
      throw navError; // Throw original error
    }
  }

  // Extract full page content for LLM analysis
  console.log(`  → Extracting full page content...`);
  const pageContent = await page.evaluate(() => {
    // Get the page title
    const title = document.title;
    
    // Get all visible text content, cleaned up
    const bodyText = document.body ? document.body.innerText : '';
    
    // Get page URL
    const url = window.location.href;
    
    return {
      title,
      url,
      fullContent: bodyText
    };
  });

  console.log(`  → Extracted ${pageContent.fullContent.length} characters of content`);

  // Send full page content to LLM for extraction and matching
  const analysisResult = await analyzeJobPageWithLLM(agent, pageContent, job, profile, scanPrompt);
  
  console.log(`  → Deep scan completed for ${job.url}, match score: ${analysisResult.matchScore}`);
  return analysisResult;
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

  // Try Cloudflare AI first
  try {
    console.log(`  → Analyzing full page with Cloudflare AI...`);
    const response = await agent.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'user', content: prompt }]
    });
    console.log(`  → AI analysis complete`);

    try {
      // Clean and parse the response
      let cleanResponse = response.response
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
      console.error('Error parsing AI analysis:', parseError);
      console.log(`  → Falling back to keyword matching due to parse error`);
      return fallbackJobMatching({ 
        title: job.title,
        company: job.company,
        location: job.location,
        description: pageContent.fullContent.substring(0, 2000)
      }, profile, scanPrompt);
    }
    
  } catch (aiError) {
    console.log(`  → AI analysis failed: ${aiError.message}`);
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
