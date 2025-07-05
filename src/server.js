import Fastify from "fastify";
import mcp from "fastify-mcp";
import cron from "fastify-cron";
import { scrapeLinkedIn } from "./scrape.js";
import { filterJobs }     from "./filter.js";
import { saveMatches }    from "./save.js";
import { sendDigest }     from "./mailer.js";
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
      const raw     = await scrapeLinkedIn(process.env.LINKEDIN_SEARCH_URL);
      const matches = await filterJobs(raw, await fs.readFile("profile.txt", "utf8"));
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
  const to      = req.body.email;
  const raw     = await scrapeLinkedIn(process.env.LINKEDIN_SEARCH_URL);
  const matches = await filterJobs(raw, await fs.readFile("profile.txt", "utf8"));
  await saveMatches(matches);
  await sendDigest(to, matches);
  reply.send({ sent: matches.length });
});

app.listen({ port: 8000, host: "0.0.0.0" });
