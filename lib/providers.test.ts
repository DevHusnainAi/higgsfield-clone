// The render worker's provider path: the free tier's Cloudflare call, image sizes, and which failures may use
// the stock fallback. No network: fetch is stubbed where a response is needed.
import assert from "node:assert/strict";
import test from "node:test";
import { ASPECT_RATIOS, parseIntent } from "./intent.ts";
import { canFallBack, cloudflareRequest, imageSize, reasonFor, renderCloudflare } from "./server/run-generation.ts";

const ENV = { CF_ACCOUNT_ID: "acct123", CF_API_TOKEN: "cf-token" };
const image = (prompt: string, overrides = {}) => parseIntent(prompt, { model: "sdxl-lightning", ...overrides });
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { httpResponse: { status } });

test("image sizes: every aspect ratio is in multiples of 64, about a megapixel, within SDXL's 256-2048", () => {
  for (const ratio of ASPECT_RATIOS) {
    const { width, height } = imageSize(ratio);
    assert.equal(width % 64, 0, `${ratio} width`);
    assert.equal(height % 64, 0, `${ratio} height`);
    const mp = (width * height) / 2 ** 20;
    assert.ok(mp > 0.85 && mp < 1.15, `${ratio}: ${width}x${height} is ${mp.toFixed(2)} MP`);
    assert.ok(Math.min(width, height) >= 256 && Math.max(width, height) <= 2048, `${ratio}: ${width}x${height}`);
    const [w, h] = ratio.split(":").map(Number);
    assert.ok(Math.abs(width / height - w / h) / (w / h) < 0.08, `${ratio}: ${width}x${height} keeps its shape`);
  }
});

test("cloudflare request: model URL, bearer token, prompt, size from the ratio, 8 steps, seed only when set", () => {
  const { url, init } = cloudflareRequest(image("a lighthouse at dusk, 16:9"), ENV);
  assert.equal(url, "https://api.cloudflare.com/client/v4/accounts/acct123/ai/run/@cf/bytedance/stable-diffusion-xl-lightning");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.authorization, "Bearer cf-token");
  assert.deepEqual(JSON.parse(init.body), { prompt: "a lighthouse at dusk, 16:9", ...imageSize("16:9"), num_steps: 8 });
  assert.equal(JSON.parse(cloudflareRequest(image("a lighthouse", { seed: 42 }), ENV).init.body).seed, 42);
});

test("cloudflare render: PNG bytes come back as the image; errors carry their status, so 429 is capacity", async (t) => {
  // Hermetic: whatever CF_* the shell has (real credentials) is set aside, so no request ever leaves the machine.
  const saved = { CF_ACCOUNT_ID: process.env.CF_ACCOUNT_ID, CF_API_TOKEN: process.env.CF_API_TOKEN };
  delete process.env.CF_ACCOUNT_ID;
  delete process.env.CF_API_TOKEN;
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  });
  t.mock.method(globalThis, "fetch", async () => assert.fail("no network in tests"));
  const signal = new AbortController().signal;
  await assert.rejects(renderCloudflare(image("a fox"), signal), /Set CF_ACCOUNT_ID and CF_API_TOKEN/, "not configured: a normal failure");
  Object.assign(process.env, ENV);

  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  t.mock.method(globalThis, "fetch", async () => new Response(png, { headers: { "content-type": "image/png" } }));
  const blob = await renderCloudflare(image("a fox"), signal);
  assert.equal(blob.type, "image/png");
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), png);

  t.mock.method(globalThis, "fetch", async () => Response.json({ errors: [{ message: "rate limited" }] }, { status: 429 }));
  const limited = await renderCloudflare(image("a fox"), signal).catch((e: unknown) => e);
  assert.equal(reasonFor(limited, signal), "capacity");
  assert.match((limited as Error).message, /429.*rate limited/);

  t.mock.method(globalThis, "fetch", async () => Response.json({ success: false }, { status: 200 })); // 200 but not an image
  assert.equal(reasonFor(await renderCloudflare(image("a fox"), signal).catch((e: unknown) => e), signal), "provider_error");

  t.mock.method(globalThis, "fetch", async () => new Response("payment required", { status: 402 }));
  const billing = await renderCloudflare(image("a fox"), signal).catch((e: unknown) => e);
  assert.equal(canFallBack(null, billing, false, true), false, "a Cloudflare 402 fails and refunds, never the stock fallback");
});

test("stock fallback: only a 402 on the shared HF/fal keys, never after a cancel or timeout, and only when enabled", () => {
  assert.equal(canFallBack({ shared: true }, httpError(402), false, true), true);
  assert.equal(canFallBack({ shared: false }, httpError(402), false, true), false, "a user's own key: their billing");
  assert.equal(canFallBack(null, httpError(402), false, true), false, "Cloudflare");
  assert.equal(canFallBack({ shared: true }, httpError(500), false, true), false);
  assert.equal(canFallBack({ shared: true }, httpError(402), true, true), false, "aborted");
  assert.equal(canFallBack({ shared: true }, httpError(402), false, false), false, "DEMO_FALLBACK=off");
});
