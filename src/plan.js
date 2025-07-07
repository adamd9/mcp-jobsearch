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
      return { profile: '', searchTerms: [], scanPrompt: '' };
    }
    throw err;
  }
}

export async function savePlan(plan) {
  await fs.writeFile(PLAN_PATH, JSON.stringify(plan, null, 2), 'utf8');
}

export async function createPlanFromDescription(description) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const prompt = `Convert the following description into a JSON job search plan with fields "profile", "searchTerms" (array of strings), and "scanPrompt".
Description:
${description}`;

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
  plan.profile = plan.profile || description;
  plan.searchTerms = plan.searchTerms || [];
  plan.scanPrompt = plan.scanPrompt || description;

  await savePlan(plan);
  return plan;
}

export async function updatePlanFromDescription(description) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const currentPlan = await getPlan();
  
  const prompt = `Update the following job search plan based on this change request: "${description}"

Current plan:
${JSON.stringify(currentPlan, null, 2)}

Provide a complete updated JSON plan with fields "profile", "searchTerms" (array of strings), and "scanPrompt". Incorporate the requested changes while preserving relevant existing information.`;

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
  updatedPlan.scanPrompt = updatedPlan.scanPrompt || currentPlan.scanPrompt || '';

  await savePlan(updatedPlan);
  return updatedPlan;
}
