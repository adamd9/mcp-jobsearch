# Project Brief · “mcp-jobsearch-node”

Create a **Node 18+** project that exposes an MCP‑compliant HTTP server which:

1. **Scrapes LinkedIn Jobs** (given a saved search URL)  
2. **Filters the hits with an LLM** (OpenAI GPT‑4o – or a local model if the user flips a flag)  
3. **Stores the daily matches** in `data/matches-YYYY-MM-DD.json`  
4. **Exposes two MCP tools/resources**

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/plan` | Retrieve the current plan. |
| `POST` | `/plan` | Generate a plan from a natural language description. |
| `PUT`  | `/plan` | Update the existing plan fields. |
| `GET`  | `/latest_matches` | Return the JSON array from today’s file (or the most recent one). |
| `POST` | `/send_digest` | Body param `{ "email": "you@example.com" }` → run a full scrape and email the matches. |

---

## 0 · Project Scaffold

```bash
mkdir mcp-jobsearch-node && cd $_
npm init -y
npm pkg set type="module"
npm i playwright openai nodemailer fastify fastify-mcp fastify-cron dotenv
mkdir -p src data
touch .env README.md
```

**Why**

* **Fastify** → lightweight HTTP layer  
* **fastify-mcp** → helper that adds MCP schema routes  
* **fastify-cron** → schedule the daily scrape at 07:00 AEST  
* **Playwright (Chromium)** → headless LinkedIn scraping  
* **OpenAI SDK** → GPT‑4o call for relevance scoring  
* **dotenv** → secrets management  
* **nodemailer** → SMTP digest  

---

## 1 · Environment Variables (`.env`)

```env
LINKEDIN_EMAIL=…
LINKEDIN_PASSWORD=…
OPENAI_API_KEY=…
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=…
SMTP_PASS=…
DIGEST_TO=you@example.com
TIMEZONE=Australia/Sydney
# plan.json defines search terms and scan prompt
```

---

## 2 · Core Modules

### `src/scrape.js`

```js
import { chromium } from "playwright";

export async function scrapeLinkedIn(url) {
  const browser = await chromium.launch({ headless: true });
  const page    = await browser.newPage();
  await page.goto("https://www.linkedin.com/login");
  await page.type("#username", process.env.LINKEDIN_EMAIL);
  await page.type("#password", process.env.LINKEDIN_PASSWORD);
  await page.click("[type=submit]");
  await page.goto(url, { waitUntil: "networkidle" });
  const jobs = await page.$$eval("ul.jobs-search-results__list li", els =>
    els.map(el => ({
      title:  el.querySelector("h3")?.innerText.trim(),
      link:   el.querySelector("a")?.href.split("?")[0],
      posted: el.querySelector("time")?.dateTime
    }))
  );
  await browser.close();
  return jobs;
}
```

### `src/filter.js`

```js
import OpenAI from "openai";
const openai = new OpenAI();

export async function filterJobs(jobs, profile) {
  const prompt = `
You are a recruiting assistant. Given the candidate profile and an array of job ads, return only those that are a strong fit.

Candidate profile:
${profile}

Jobs JSON:
${JSON.stringify(jobs, null, 2)}
`;
  const { choices } = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2
  });
  return JSON.parse(choices[0].message.content);
}
```

### `src/save.js`

```js
import fs from "fs/promises";
import { format } from "date-fns-tz";

export async function saveMatches(matches) {
  const dateStr = format(new Date(), "yyyy-MM-dd", { timeZone: process.env.TIMEZONE });
  const path    = `data/matches-${dateStr}.json`;
  await fs.writeFile(path, JSON.stringify(matches, null, 2));
  return path;
}
```

### `src/mailer.js`

```js
import nodemailer from "nodemailer";

export async function sendDigest(to, matches) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  const html = `<ul>${matches.map(m => `<li><a href="${m.link}">${m.title}</a></li>`).join("")}</ul>`;
  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to,
    subject: `Job matches ${new Date().toLocaleDateString()}`,
    html
  });
}
```

---

## 3 · Fastify MCP Server (`src/server.js`)

```js
import Fastify from "fastify";
import mcp from "fastify-mcp";
import cron from "fastify-cron";
import { scrapeLinkedIn } from "./scrape.js";
import { saveMatches }    from "./save.js";
import { sendDigest }     from "./mailer.js";
import { getPlan }        from "./plan.js";
import fs from "fs/promises";
import dotenv from "dotenv";
dotenv.config();

const app = Fastify();
await app.register(mcp);
await app.register(cron, {
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

// MCP resource
app.get("/latest_matches", async () => {
  const files = await fs.readdir("data");
  const latest = files.sort().pop();
  return latest ? JSON.parse(await fs.readFile(`data/${latest}`)) : [];
});

// MCP tool
app.post("/send_digest", async (req, reply) => {
  const to   = req.body.email;
  const plan = await getPlan();
  for (const term of plan.searchTerms) {
    const url = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(term)}`;
    await scrapeLinkedIn(url, { deepScan: true, profileText: plan.profile, scanPrompt: plan.scanPrompt });
  }
  const matches = await getMatchedJobs(0.7);
  await saveMatches(matches);
  await sendDigest(to, matches);
  reply.send({ sent: matches.length });
});

app.listen({ port: 8000, host: "0.0.0.0" });
```

---

## 4 · Run Locally

```bash
cat > plan.json <<EOF
{ "profile": "Senior full-stack engineer", "searchTerms": ["node", "typescript"], "scanPrompt": "Focus on serverless roles" }
EOF
node src/server.js
# Server up at http://localhost:8000
# Cron will auto‑email daily digest at 07:00 AEST
```

---

## 5 · Deploy

* **Fly.io / Railway / Render** – easiest “one‑click” Node deploy (map your `.env`).  
* **Systemd on a VPS** – create a unit that runs `node src/server.js`.  

---

## 6 · Using MCP Tools

* **GET** `/plan` → current plan
* **POST** `/plan` with body `{ "description": "..." }` → create plan
* **PUT** `/plan` → update plan
* **GET** `/latest_matches` → JSON array
* **POST** `/send_digest` with body `{ "email": "me@me.com" }` → `{ "sent": N }`

Any MCP‑aware LLM or workflow (LangGraph, AutoGen, etc.) can now invoke those endpoints as tools.

---

## 7 · Future Extensions

* **Seek integration** – add a `scrapeSeek()` variant and toggle by query param.  
* **Vector‑DB cache** – store embeddings in Chroma to dedupe job ads.  
* **Local model option** – set `LLM_PROVIDER=ollama` and call `http://localhost:11434`.  
* **Dashboard** – plug Grafana + Loki for logs & metrics.  
