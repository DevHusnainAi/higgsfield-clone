// Automated WCAG 2.2 AA pass (axe-core) over the studio's main states, in a real Chromium.
// Needs a running server in LOCAL mode (no Supabase env), so it never writes to a live project:
//   NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY= SUPABASE_SECRET_KEY= npm run build
//   NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY= SUPABASE_SECRET_KEY= npm start
//   npm run test:a11y            # BASE_URL defaults to http://localhost:3000
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { AxeBuilder } from "@axe-core/playwright";
import { chromium, type Browser, type Page } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

let browser: Browser;
before(async () => {
  browser = await chromium.launch();
});
after(() => browser.close());

async function audit(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const report = violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.map((n) => n.target.join(" ")).join("\n    ")}`);
  assert.equal(violations.length, 0, `${label}:\n  ${report.join("\n  ")}`);
}

async function open(width = 1280) {
  const page = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage(); // axe needs an explicit context
  await page.goto(BASE, { waitUntil: "networkidle" });
  assert.equal(await page.locator("aside dt", { hasText: "Balance" }).count(), 0, "server is in Supabase mode; run it in local mode (see header)");
  return page;
}

test("home: inspiration feed and empty composer", async () => {
  const page = await open();
  await audit(page, "home");
  await page.close();
});

test("composer: parsed chips, an open chip menu, and the Advanced panel", async () => {
  const page = await open();
  await page.locator("#prompt").fill("Slow dolly-in on pour-over coffee brewing, vertical video, 6s");
  await audit(page, "composer with chips");
  await page.locator("form li button").first().click();
  await audit(page, "chip menu open");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /advanced/i }).click();
  await audit(page, "advanced panel open");
  await page.close();
});

test("run: stage + inspector, then the library", async () => {
  const page = await open();
  await page.locator("#prompt").fill("Portrait photo of a dancer, 9:16");
  await page.keyboard.press("Enter");
  // Any settled state: "Done…" or any failure, which always ends "…credits returned to your balance".
  // (Matching "error" missed the simulator's capacity failure, about 6% of runs, and timed out.)
  await page.waitForFunction(() => /^Done|returned to your balance/.test(document.querySelector("main [role=status]")?.textContent ?? ""), null, { timeout: 30_000 });
  await audit(page, "finished run");
  await page.locator("aside").getByRole("button", { name: /^All/ }).click();
  await audit(page, "library");
  await page.close();
});

test("mobile: drawer open at 375px", async () => {
  const page = await open(375);
  await page.getByRole("button", { name: "Open menu" }).click();
  await audit(page, "mobile drawer");
  await page.close();
});
