// Sign-in flows in a real Chromium, with Supabase mocked at the network layer (nothing leaves the machine).
// Needs a server built against the fake project URL these mocks answer for:
//   NEXT_PUBLIC_SUPABASE_URL=https://fake.supabase.test NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test npm run build
//   NEXT_PUBLIC_SUPABASE_URL=https://fake.supabase.test NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test npm start
//   npm run test:auth            # BASE_URL defaults to http://localhost:3000
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { AxeBuilder } from "@axe-core/playwright";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SUPABASE = "https://fake.supabase.test";
const STORAGE_KEY = "sb-fake-auth-token"; // supabase-js: sb-<project ref>-auth-token; also its BroadcastChannel name
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const user = (id: string, anonymous: boolean) => ({
  id, aud: "authenticated", role: "authenticated", is_anonymous: anonymous,
  email: anonymous ? "" : "maya@agency.com", user_metadata: anonymous ? {} : { full_name: "Maya Chen" },
  app_metadata: {}, created_at: new Date().toISOString(),
});
const session = (u: ReturnType<typeof user>) => ({
  access_token: `h.${b64({ sub: u.id, exp, role: "authenticated", is_anonymous: u.is_anonymous })}.s`,
  token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: `r-${u.id}`, user: u,
});
const GUEST = user("11111111-1111-1111-1111-111111111111", true);
const MAYA = user("22222222-2222-2222-2222-222222222222", false);

let browser: Browser;
before(async () => {
  browser = await chromium.launch();
});
after(() => browser.close());

async function context(opts: { reducedMotion?: "reduce"; width?: number } = {}) {
  const ctx = await browser.newContext({ viewport: { width: opts.width ?? 1280, height: 860 }, reducedMotion: opts.reducedMotion });
  await ctx.route(`${SUPABASE}/**`, async (r) => {
    const path = new URL(r.request().url()).pathname;
    const method = r.request().method();
    if (path === "/auth/v1/signup") return r.fulfill({ json: session(GUEST) }); // anonymous sign-in
    if (path === "/auth/v1/otp") return r.fulfill({ json: {} }); // magic link sent
    if (path === "/auth/v1/user" && method === "PUT") return r.fulfill({ json: { ...GUEST, new_email: "maya@agency.com" } });
    if (path === "/auth/v1/user") return r.fulfill({ json: GUEST });
    return r.fulfill({ status: 404, json: {} });
  });
  await ctx.route("**/api/generations", (r) => r.fulfill({ json: { runs: [], balance: 40 } }));
  return ctx;
}

async function axe(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  assert.equal(violations.length, 0, `${label}:\n  ${violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`).join("\n  ")}`);
}

/** Another tab of this browser opened the email link: it saves the session and broadcasts SIGNED_IN. */
async function openLinkInAnotherTab(ctx: BrowserContext) {
  const other = await ctx.newPage();
  await other.goto(`${BASE}/privacy`); // any page of the app: same origin, same storage, same channel
  await other.evaluate(
    ([key, s]) => {
      localStorage.setItem(key, JSON.stringify(s));
      new BroadcastChannel(key).postMessage({ event: "SIGNED_IN", session: s });
    },
    [STORAGE_KEY, session(MAYA)] as const,
  );
  await other.close();
}

async function sendLink(page: Page) {
  await page.getByLabel("Email", { exact: true }).fill("maya@agency.com");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await page.getByRole("heading", { name: "Check your inbox" }).waitFor();
}

test("page: start state is accessible, link-only by default, Google button uses its branding values", async () => {
  const ctx = await context();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/sign-in`, { waitUntil: "networkidle" });
  assert.equal(await page.getByText("Accounts aren't set up").count(), 0, "server is not built against the fake Supabase URL (see header)");
  await page.getByRole("button", { name: "Continue with Google" }).waitFor();
  await axe(page, "sign-in page, start");
  assert.equal(await page.getByRole("button", { name: /Have a code/ }).count(), 0, "code entry is off unless NEXT_PUBLIC_EMAIL_CODES=on");
  const google = await page.getByRole("button", { name: "Continue with Google" }).evaluate((e) => {
    const s = getComputedStyle(e);
    return [s.backgroundColor, s.borderTopColor, s.color];
  });
  assert.deepEqual(google, ["rgb(19, 19, 20)", "rgb(142, 145, 143)", "rgb(227, 227, 227)"]);
  assert.equal(await page.locator(".glass-media").count(), 0, "no status pill while idle: nothing to report");
  await ctx.close();
});

test("page: waiting state, then the link opened in another tab completes this one", async () => {
  const ctx = await context();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/sign-in`, { waitUntil: "networkidle" });
  await sendLink(page);

  assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Check your inbox", "focus moves to the new heading");
  assert.match(await page.getByRole("status").innerText(), /Waiting for you to open the link/);
  assert.match(await page.locator(".glass-media").innerText(), /Waiting for you to open the link/);
  const resend = page.getByRole("button", { name: /Resend link in \d+s/ });
  assert.equal(await resend.getAttribute("aria-disabled"), "true", "resend stays focusable during the countdown");
  await axe(page, "sign-in page, waiting");

  await page.mouse.move(5, 5); // no pointer movement for 1.5s: Iris watches the radar
  await page.waitForTimeout(1700);
  assert.equal(await page.locator("svg[data-state]").getAttribute("data-state"), "watch");

  await openLinkInAnotherTab(ctx);
  await page.getByRole("status").filter({ hasText: "You're signed in" }).waitFor({ timeout: 3000 });
  assert.match(await page.locator(".glass-media").innerText(), /Signed in/);
  await page.waitForURL(`${BASE}/`, { timeout: 5000 }); // the page hands back to the studio
  await ctx.close();
});

test("modal: waiting state over the studio is accessible; the cross-tab sign-in closes it", async () => {
  const ctx = await context();
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.locator("aside").getByRole("link", { name: "Activate history" }).click();
  await page.locator("dialog[open]").waitFor();
  assert.equal(new URL(page.url()).pathname, "/sign-in");
  await axe(page, "sign-in modal, start");
  await sendLink(page);
  await axe(page, "sign-in modal, waiting");
  await openLinkInAnotherTab(ctx);
  await page.locator("dialog[open]").waitFor({ state: "detached", timeout: 5000 });
  assert.equal(new URL(page.url()).pathname, "/");
  await ctx.close();
});

test("reduced motion: radar and Iris are still, the waiting state still works", async () => {
  const ctx = await context({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/sign-in`, { waitUntil: "networkidle" });
  const pupil = () => page.locator('[data-part="pupil0"]').getAttribute("transform");
  const rest = await pupil();
  await page.mouse.move(10, 10);
  await page.mouse.move(1270, 850);
  await page.waitForTimeout(300);
  assert.equal(await pupil(), rest, "eyes don't follow the pointer");
  await sendLink(page);
  const rings = page.locator('[aria-hidden] > span[class*="radar"]');
  assert.ok((await rings.count()) > 0, "radar rings are rendered");
  const animated = await rings.evaluateAll((els) => els.map((e) => getComputedStyle(e).animationName).filter((n) => n !== "none"));
  assert.deepEqual(animated, [], "radar rings don't animate");
  const iris = await page.locator(".iris-float, .iris-shadow, .iris-spark-live").evaluateAll((els) => els.map((e) => getComputedStyle(e).animationName));
  assert.equal(iris.length, 3, "float, shadow and live spark are rendered");
  assert.deepEqual(iris.filter((n) => n !== "none"), [], "Iris's float, shadow and spark don't animate");
  await axe(page, "sign-in page, waiting, reduced motion");
  await ctx.close();
});

test("Google link to an email that already has an account signs in to it (once), keeping the guest's history", async () => {
  const ctx = await context();
  const authorize: string[] = [];
  await ctx.route(`${SUPABASE}/auth/v1/authorize**`, (r) => {
    authorize.push(r.request().url());
    return r.fulfill({ contentType: "text/html", body: "<p>Google</p>" });
  });
  const page = await ctx.newPage();
  await page.addInitScript(([key, s]) => localStorage.setItem(key, JSON.stringify(s)), [STORAGE_KEY, session(GUEST)] as const);
  // What Supabase sends back when linking Google to the guest finds the email already registered.
  await page.goto(`${BASE}/?error=server_error&error_code=email_exists&error_description=A+user+with+this+email+address+has+already+been+registered`);
  await page.waitForURL(/fake\.supabase\.test\/auth\/v1\/authorize/, { timeout: 5000 });
  assert.equal(authorize.length, 1);
  assert.match(authorize[0], /provider=google/);
  const handoff = (await ctx.storageState()).origins.find((o) => o.origin === BASE)?.localStorage.find((i) => i.name === "studio.guest-handoff");
  assert.ok(handoff && JSON.parse(handoff.value).uid === GUEST.id, "guest token saved so its history can be merged");

  // The same error again right away (e.g. a real misconfiguration) is shown, not retried in a loop.
  await page.goto(`${BASE}/?error=server_error&error_code=email_exists&error_description=A+user+with+this+email+address+has+already+been+registered`);
  await page.getByText(/Sign-in failed: A user with this email address/).waitFor({ timeout: 5000 });
  assert.equal(authorize.length, 1);
  await ctx.close();
});
