import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIntent } from "./intent.ts";
import { createGeneration, simulateGeneration, statusMessage, transition, type Generation } from "./generation.ts";

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
  assert.match(parseIntent("drone shot, 4:5").warnings[0], /4:5 became 9:16/);
  const still = parseIntent("photo, slow pan left");
  assert.equal(still.camera, null);
  assert.match(still.warnings[0], /only apply to video/);
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
