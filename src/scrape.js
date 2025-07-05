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
