import fs from "fs/promises";
import { format } from "date-fns-tz";

export async function saveMatches(matches) {
  const dateStr = format(new Date(), "yyyy-MM-dd", { timeZone: process.env.TIMEZONE });
  const path    = `data/matches-${dateStr}.json`;
  await fs.mkdir("data", { recursive: true });
  await fs.writeFile(path, JSON.stringify(matches, null, 2));
  return path;
}
