import fs from 'fs/promises';
import path from 'path';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const PLAN_PATH = path.join(process.cwd(), 'plan.json');

export async function getPlan() {
  try {
    const data = await fs.readFile(PLAN_PATH, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { 
        profile: '', 
        searchTerms: [], 
        locations: [],
        scanPrompt: '',
        searchUrls: []
      };
    }
    throw err;
  }
}

export async function savePlan(plan) {
  await fs.writeFile(PLAN_PATH, JSON.stringify(plan, null, 2), 'utf8');
}

/**
 * Generate LinkedIn search URLs based on search terms and locations
 * @param {Array} searchTerms - Array of search terms
 * @param {Array} locations - Array of location objects with name, geoId, and type
 * @returns {Array} - Array of search URL objects
 */
export function generateSearchUrls(searchTerms, locations) {
  const baseUrl = 'https://www.linkedin.com/jobs/search/';
  const urls = [];

  // If no locations specified, do a general search for each term
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

  // Generate cross-product of search terms and locations
  searchTerms.forEach(term => {
    locations.forEach(loc => {
      let url = `${baseUrl}?keywords=${encodeURIComponent(term)}`;
      
      // Add location parameters based on location type
      if (loc.geoId) {
        url += `&location=${encodeURIComponent(loc.name)}&geoId=${loc.geoId}`;
        
        // Add distance parameter for city searches
        if (loc.type === 'city' && loc.distance) {
          url += `&distance=${loc.distance}`;
        }
      } else if (loc.name === 'Remote') {
        url += '&f_WT=2'; // Remote work filter
      }
      
      // Add sorting by date
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

export async function createPlanFromDescription(description) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    messages: [
      { role: 'system', content: 'You create structured job search plans.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.2
  });

  const content = response.choices[0].message.content;
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  let plan;
  try {
    plan = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
  } catch (e) {
    plan = {};
  }
  
  // Ensure all required fields exist
  plan.profile = plan.profile || description;
  plan.searchTerms = plan.searchTerms || [];
  plan.locations = plan.locations || [];
  plan.scanPrompt = plan.scanPrompt || description;
  
  // Generate search URLs
  plan.searchUrls = generateSearchUrls(plan.searchTerms, plan.locations);

  // Generate feedback for plan improvement
  plan.feedback = await generatePlanFeedback(plan);

  await savePlan(plan);
  return plan;
}

export async function updatePlanFromDescription(description) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const currentPlan = await getPlan();
  
  const prompt = `Update the following job search plan based on this change request: "${description}"

Current plan:
${JSON.stringify(currentPlan, null, 2)}

Provide a complete updated JSON plan with these fields:
- "profile": A concise summary of the job seeker's profile
- "searchTerms": Array of search terms/keywords (each item should be a complete search query)
- "locations": Array of location objects, each with:
  - "name": Location name (city, state, country)
  - "geoId": LinkedIn geographic ID if known (optional)
  - "type": "city", "country", or "remote"
  - "distance": Search radius in miles (for city searches, optional)
- "scanPrompt": Instructions for evaluating job matches

Incorporate the requested changes while preserving relevant existing information.
Respond with ONLY the JSON object. No additional text.`;

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    messages: [
      { role: 'system', content: 'You update structured job search plans based on user requests.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.2
  });

  const content = response.choices[0].message.content;
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  let updatedPlan;
  try {
    updatedPlan = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
  } catch (e) {
    // If parsing fails, keep the current plan and just add the description to notes
    updatedPlan = { ...currentPlan };
  }
  
  // Ensure all required fields exist
  updatedPlan.profile = updatedPlan.profile || currentPlan.profile || '';
  updatedPlan.searchTerms = updatedPlan.searchTerms || currentPlan.searchTerms || [];
  updatedPlan.locations = updatedPlan.locations || currentPlan.locations || [];
  updatedPlan.scanPrompt = updatedPlan.scanPrompt || currentPlan.scanPrompt || '';
  
  // Generate search URLs
  updatedPlan.searchUrls = generateSearchUrls(updatedPlan.searchTerms, updatedPlan.locations);

  // Generate feedback for plan improvement
  updatedPlan.feedback = await generatePlanFeedback(updatedPlan);

  await savePlan(updatedPlan);
  return updatedPlan;
}

/**
 * Generate feedback on how the plan could be improved
 * @param {Object} plan - The job search plan
 * @returns {Object} - Feedback object with suggestions
 */
export async function generatePlanFeedback(plan) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  
  const prompt = `Analyze this job search plan and provide specific, actionable feedback on how it could be improved:

${JSON.stringify(plan, null, 2)}

Focus on:
1. Search term quality (specificity, relevance, Boolean operators)
2. Location coverage (missing important areas?)
3. Profile completeness (skills, experience level, industry focus)
4. Scan prompt effectiveness

Respond with a JSON object with these fields:
- "searchTermsFeedback": String with suggestions for search terms
- "locationsFeedback": String with suggestions for locations
- "profileFeedback": String with suggestions for profile
- "scanPromptFeedback": String with suggestions for scan prompt
- "overallRating": Number from 1-10 indicating plan quality

Keep each feedback field concise (1-2 sentences).`;

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    messages: [
      { role: 'system', content: 'You analyze job search plans and provide concise, actionable feedback.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.3
  });

  const content = response.choices[0].message.content;
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  let feedback;
  try {
    feedback = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
  } catch (e) {
    feedback = {
      searchTermsFeedback: "Unable to analyze search terms.",
      locationsFeedback: "Unable to analyze locations.",
      profileFeedback: "Unable to analyze profile.",
      scanPromptFeedback: "Unable to analyze scan prompt.",
      overallRating: 5
    };
  }
  
  return feedback;
}
