import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIntent, remixOverrides, sanitizeOverrides } from "./intent.ts";
import { cheaperAlternatives, costBreakdown, createGeneration, estimateCost, splitBatch, simulateGeneration, statusMessage, transition, type Generation } from "./generation.ts";

test("parseIntent: reads media, camera, ratio, duration", () => {
  const cases: [string, Partial<ReturnType<typeof parseIntent>>][] = [
    ["A slow dolly-in on a rain-soaked neon street, 35mm, night", { media: "video", camera: "dolly-in", aspectRatio: "16:9", durationSec: 5 }],
    ["portrait photo of a chef, 4:5", { media: "image", camera: null, aspectRatio: "4:5", durationSec: null }],
    ["a frying pan on a stove", { media: "image", camera: null }],
    ["a 90s style photo of a diner", { media: "image", durationSec: null }],
    ["drone shot over cliffs, 30 seconds, 9:16", { media: "video", camera: "fpv", aspectRatio: "9:16", durationSec: 6 }],
    ["slow pan left across a desert, 21:9", { media: "video", camera: "pan-left", aspectRatio: "16:9" }],
    ["product video, 4:5", { media: "video", aspectRatio: "9:16" }],
    ["product video without zooming in, slow pan left", { media: "video", camera: "pan-left" }],
    ["slow zoom out from a lighthouse", { media: "video", camera: "zoom-out" }],
    ["a tilt-shift photo of a city", { media: "image", camera: null }],
    ["tiktok reel of a barista, 4s", { media: "video", aspectRatio: "9:16", durationSec: 4 }],
    ["a 2x3 grid of photos at 2/3 scale", { media: "image", aspectRatio: "1:1" }],
  ];
  for (const [prompt, expected] of cases) {
    const intent = parseIntent(prompt);
    for (const [k, v] of Object.entries(expected)) {
      assert.deepEqual(intent[k as keyof typeof intent], v, `${prompt} -> ${k}`);
    }
  }
});

test("parseIntent: explains adjustments instead of hiding them", () => {
  assert.equal(parseIntent("drone shot, 30 seconds").warnings.length, 1);
  assert.match(parseIntent("drone shot, 4:5").warnings[0].message, /4:5 became 9:16/);
  const still = parseIntent("photo, slow pan left");
  assert.equal(still.camera, null);
  assert.match(still.warnings[0].message, /only apply to video/);
  assert.equal(parseIntent("x".repeat(5000)).prompt.length, 4000);
});

test("parseIntent: never throws on junk", () => {
  for (const junk of ["", "   ", null, undefined, 42, {}, "🎥🎥", "::::", "0:0 0s"]) {
    const intent = parseIntent(junk);
    assert.equal(intent.media, "image");
    assert.equal(intent.camera, null);
  }
});

test("transition: failure always refunds; terminal states are final", () => {
  const gen = createGeneration(parseIntent("drone shot, 5s"), 0);
  assert.deepEqual(gen.credits, { amount: 30, state: "held" });
  const failed = transition(transition(gen, { type: "start" }, 1), { type: "fail", reason: "capacity" }, 2);
  assert.equal(failed.status, "failed");
  assert.deepEqual(failed.credits, { amount: 30, state: "refunded", refundedAt: 2 });
  assert.match(statusMessage(failed), /30 credits returned/);
  assert.equal(transition(failed, { type: "complete", resultUrl: "x" }), failed);
  assert.throws(() => createGeneration(parseIntent("  ")), RangeError);
});

test("transition: progress never moves backwards", () => {
  let gen = transition(createGeneration(parseIntent("photo")), { type: "start" });
  gen = transition(gen, { type: "progress", progress: 0.6 });
  gen = transition(gen, { type: "progress", progress: 0.2 });
  assert.equal(gen.status === "generating" && gen.progress, 0.6);
});

const run = async (random: () => number, signal?: AbortSignal) => {
  const seen: Generation["status"][] = [];
  const final = await simulateGeneration(parseIntent("slow dolly in, 6s"), {
    random,
    signal,
    sleep: (_ms, s) => (s?.aborted ? Promise.reject(s.reason) : Promise.resolve()),
    onUpdate: (g) => { if (seen.at(-1) !== g.status) seen.push(g.status); },
  });
  return { final, seen };
};

test("simulateGeneration: success charges, failure refunds, abort cancels", async () => {
  const ok = await run(() => 0.5);
  assert.deepEqual(ok.seen, ["queued", "generating", "done"]);
  assert.equal(ok.final.credits.state, "charged");

  const bad = await run(() => 0.05); // below FAILURE_RATE
  assert.deepEqual(bad.seen, ["queued", "generating", "failed"]);
  assert.equal(bad.final.status === "failed" && bad.final.credits.state, "refunded");

  const ctrl = new AbortController();
  ctrl.abort();
  const cancelled = await run(() => 0.5, ctrl.signal);
  assert.equal(cancelled.final.status === "failed" && cancelled.final.reason, "cancelled");
  assert.equal(cancelled.final.credits.state, "refunded");
});

test("overrides beat the parser, are re-validated, and replace stale warnings", () => {
  const base = parseIntent("drone shot over cliffs, 30 seconds");
  assert.equal(base.warnings.length, 1);
  const o = parseIntent("drone shot over cliffs, 30 seconds", { durationSec: 4, aspectRatio: "9:16", camera: "orbit" });
  assert.deepEqual([o.durationSec, o.aspectRatio, o.camera, o.warnings.length], [4, "9:16", "orbit", 0]);
  // Switching to image drops video-only fields and picks the image default model.
  const img = parseIntent("drone shot, 5s", { media: "image" });
  assert.deepEqual([img.media, img.camera, img.durationSec, img.model], ["image", null, null, "sd3-medium"]);
  // Out-of-range or wrong-media values are corrected with a visible reason.
  const fixed = parseIntent("video of rain", { durationSec: 40, aspectRatio: "4:5", model: "flux-schnell", guidanceScale: 99 });
  assert.deepEqual([fixed.durationSec, fixed.aspectRatio, fixed.model, fixed.guidanceScale], [6, "9:16", "wan-2.2-5b", 10]);
  assert.deepEqual(fixed.warnings.map((w) => w.field).sort(), ["aspectRatio", "durationSec", "guidanceScale", "model"]);
  assert.equal(parseIntent("photo", { model: "flux-schnell", guidanceScale: 5 }).guidanceScale, null);
});

test("sanitizeOverrides drops anything malformed (server trust boundary)", () => {
  assert.deepEqual(sanitizeOverrides({ media: "gif", camera: "barrel-roll", aspectRatio: "5:7", durationSec: 2.5, model: "__proto__", seed: -1, guidanceScale: "7" }), {});
  assert.deepEqual(sanitizeOverrides("nope"), {});
  assert.deepEqual(sanitizeOverrides({ camera: null, seed: 42, model: "flux-schnell" }), { camera: null, seed: 42, model: "flux-schnell" });
});

test("remixOverrides rebuilds an intent from its prompt, minus the seed", () => {
  const original = parseIntent("slow pan left over a lake, 5s", { aspectRatio: "9:16", seed: 7, guidanceScale: 5 });
  const o = remixOverrides(original);
  assert.deepEqual(o, { aspectRatio: "9:16", guidanceScale: 5 });
  const again = parseIntent(original.prompt, o);
  assert.deepEqual([again.aspectRatio, again.guidanceScale, again.camera, again.seed], ["9:16", 5, "pan-left", null]);
  assert.deepEqual(remixOverrides({ prompt: "a photo" }), {}); // old runs without newer fields
  // Stored under older limits (10s); clamps to what the parser picks anyway, so it is not a user choice.
  assert.deepEqual(remixOverrides({ prompt: "drone shot, 10s", media: "video", durationSec: 10 }), {});
});

test("cheaperAlternatives offers affordable, closest-first options", () => {
  const video = parseIntent("drone shot, 5s"); // 30 credits
  assert.equal(estimateCost(video), 30);
  const opts = cheaperAlternatives(video, 20);
  assert.deepEqual(opts.map((o) => [o.label, o.cost]), [["Shorten to 3s", 18], ["Still image with Stable Diffusion 3 Medium", 4]]);
  for (const opt of opts) assert.equal(estimateCost(parseIntent(video.prompt, opt.overrides)), opt.cost);
  assert.deepEqual(cheaperAlternatives(parseIntent("a photo"), 3).map((o) => o.cost), [2]);
  assert.deepEqual(cheaperAlternatives(parseIntent("a photo"), 1), []);
});

test("batch: cost scales with count, splits into seeded single outputs, degrades to fewer outputs", () => {
  const four = parseIntent("a photo", { count: 4, seed: 10 });
  assert.equal(estimateCost(four), 16);
  assert.equal(costBreakdown(four), "4 images × 4 credits");
  assert.equal(parseIntent("a photo", { count: 9 }).count, 4);
  assert.equal(parseIntent("a photo").count, 1);
  const items = splitBatch(four);
  assert.deepEqual(items.map((i) => [i.count, i.seed, estimateCost(i)]), [[1, 10, 4], [1, 11, 4], [1, 12, 4], [1, 13, 4]]);
  assert.ok(splitBatch(parseIntent("a photo", { count: 2 })).every((i) => i.seed === null));
  const [fewer] = cheaperAlternatives(four, 10);
  assert.deepEqual([fewer.label, fewer.cost], ["Generate 2 images instead", 8]);
  for (const opt of cheaperAlternatives(four, 10)) assert.ok(estimateCost(parseIntent("a photo", { ...four, ...opt.overrides, seed: 10 })) <= 10);
});

test("reference: only a user-folder path is accepted, and it forces image-to-video", () => {
  const ref = "00000000-0000-0000-0000-00000000000a/11111111-1111-1111-1111-111111111111.png";
  for (const bad of ["https://evil.test/x.png", "../x.png", `${ref}/../y.png`, "a/b.png", `${ref}?x`, `/${ref}`, "file:///etc/passwd"]) {
    assert.equal(sanitizeOverrides({ reference: bad }).reference, undefined, bad);
  }
  const it = parseIntent("a photo of a lighthouse", { reference: ref, media: "image", model: "sd3-medium" });
  assert.deepEqual([it.media, it.model, it.reference], ["video", "wan-2.2-i2v-a14b", ref]);
  assert.ok(it.warnings.some((w) => w.field === "reference"));
  // The start-frame model is refused without a frame; remix keeps the frame.
  assert.equal(parseIntent("a clip", { model: "wan-2.2-i2v-a14b" }).model, "wan-2.2-5b");
  assert.equal(remixOverrides(it).reference, ref);
  // Falling back to a still image drops the frame.
  const still = cheaperAlternatives(parseIntent("a clip", { reference: ref }), 5).find((o) => o.overrides.media === "image")!;
  assert.equal(parseIntent("a clip", { reference: ref, ...still.overrides }).media, "image");
});
