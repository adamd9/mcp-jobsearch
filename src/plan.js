import { z } from "zod";
import { TOOL_DESCRIPTIONS, TOOL_ARGS } from './tool-descriptions.js';

// Utility: Generate LinkedIn search URLs from search terms and locations
function generateSearchUrls(searchTerms, locations) {
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

// Utility: Generate plan feedback from AI response
async function generatePlanFeedback(plan, openai, env) {
  // This function expects the same logic as _generatePlanFeedback in index.js
  // (Implementation can be improved or referenced from index.js)
  // For now, placeholder logic:
  const prompt = `Analyze the following job search plan and provide feedback as a JSON object with these fields:\n- searchTermsFeedback\n- locationsFeedback\n- profileFeedback\n- scanPromptFeedback\n- overallRating (0-10)\n\nPlan:\n${JSON.stringify(plan, null, 2)}`;
  const aiResponse = await openai.chat.completions.create({
    model: env.OPENAI_MODEL || 'gpt-4.1-mini',
    messages: [
      { role: 'system', content: 'You analyze job search plans and provide feedback.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.2
  });
  const content = aiResponse.choices[0].message.content;
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
      overallRating: 0
    };
  }
  return feedback;
}

export function getPlanTool(env) {
  return {
    name: "get_plan",
    description: TOOL_DESCRIPTIONS.GET_PLAN,
    handler: async () => {
      const plan = await env.JOB_STORAGE.get("plan", "json");
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
    options: {
      title: "Get Job Search Plan",
      readOnlyHint: true,
      openWorldHint: false
    }
  };
}



export function updatePlanTool(env, openai) {
  return {
    name: "update_plan",
    description: TOOL_DESCRIPTIONS.UPDATE_PLAN,
    args: {
      description: z.string().describe(TOOL_ARGS.PLAN_DESCRIPTION)
    },
    handler: async ({ description }) => {
      const currentPlanJSON = await env.JOB_STORAGE.get("plan");
      const currentPlan = currentPlanJSON ? JSON.parse(currentPlanJSON) : null;
      
      let prompt;
      let systemMessage;
      
      if (!currentPlan || Object.keys(currentPlan).length === 0) {
        // Creating a new plan
        prompt = `Convert the following description into a JSON job search plan with these fields:\n- \"profile\": A concise summary of the job seeker's profile\n- \"searchTerms\": Array of search terms/keywords (each item should be a complete search query)\n- \"locations\": Array of location objects, each with:\n  - \"name\": Location name (city, state, country)\n  - \"geoId\": LinkedIn geographic ID if known (optional)\n  - \"type\": \"city\", \"country\", or \"remote\"\n  - \"distance\": Search radius in miles (for city searches, optional)\n- \"scanPrompt\": Instructions for evaluating job matches\n\nDescription:\n${description}\n\nRespond with ONLY the JSON object. No additional text.`;
        systemMessage = 'You create structured job search plans.';
      } else {
        // Updating existing plan
        prompt = `Update the following job search plan based on this change request: \"${description}\"\n\nCurrent plan:\n${JSON.stringify(currentPlan, null, 2)}\n\nProvide a complete updated JSON plan with these fields:\n- \"profile\": A concise summary of the job seeker's profile\n- \"searchTerms\": Array of search terms/keywords (each item should be a complete search query)\n- \"locations\": Array of location objects, each with:\n  - \"name\": Location name (city, state, country)\n  - \"geoId\": LinkedIn geographic ID if known (optional)\n  - \"type\": \"city\", \"country\", or \"remote\"\n  - \"distance\": Search radius in miles (for city searches, optional)\n- \"scanPrompt\": Instructions for evaluating job matches\n\nIncorporate the requested changes while preserving relevant existing information.\nRespond with ONLY the JSON object. No additional text.`;
        systemMessage = 'You update structured job search plans based on user requests.';
      }
      
      const aiResponse = await openai.chat.completions.create({
        model: env.OPENAI_MODEL || 'gpt-4o',
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2
      });
      
      const content = aiResponse.choices[0].message.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      let plan;
      
      try {
        plan = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
      } catch (e) {
        plan = currentPlan ? { ...currentPlan } : {};
      }
      
      // Ensure required fields exist with fallbacks (especially important for new plans)
      plan.profile = plan.profile || description;
      plan.searchTerms = plan.searchTerms || [];
      plan.locations = plan.locations || [];
      plan.scanPrompt = plan.scanPrompt || description;
      
      plan.searchUrls = generateSearchUrls(plan.searchTerms, plan.locations);
      plan.feedback = await generatePlanFeedback(plan, openai, env);
      
      await env.JOB_STORAGE.put("plan", JSON.stringify(plan));
      
      const isNewPlan = !currentPlan || Object.keys(currentPlan).length === 0;
      const responseText = isNewPlan ? JSON.stringify(plan, null, 2) : "Plan updated.";
      
      return {
        content: [{ type: "text", text: responseText }],
        structuredContent: plan,
      };
    },
    options: {
      title: "Create/Update Job Search Plan",
      readOnlyHint: false,
      openWorldHint: true
    }
  };
}
