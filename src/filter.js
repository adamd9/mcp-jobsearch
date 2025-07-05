import OpenAI from "openai";
const defaultOpenAI = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "test" });

export async function filterJobs(jobs, profile, ai = defaultOpenAI) {
  const prompt = `
You are a recruiting assistant. Given the candidate profile and an array of job ads, return only those that are a strong fit.

Candidate profile:
${profile}

Jobs JSON:
${JSON.stringify(jobs, null, 2)}
`;
  const { choices } = await ai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2
  });
  return JSON.parse(choices[0].message.content);
}
