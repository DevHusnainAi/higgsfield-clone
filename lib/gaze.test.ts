import assert from "node:assert/strict";
import test from "node:test";
import { approach, gaze, PAW_SPRING, springStep } from "./gaze.ts";

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test("gaze: points at the target, never past the rim, small for nearby targets", () => {
  assert.deepEqual(gaze({ x: 10, y: 10 }, { x: 10, y: 10 }, 9), { x: 0, y: 0 });
  const far = gaze({ x: 1000, y: 0 }, { x: 0, y: 0 }, 9);
  close(far.x, 9);
  close(far.y, 0);
  const near = gaze({ x: 0, y: 150 }, { x: 0, y: 0 }, 9); // half the reach → half the radius
  close(near.y, 4.5);
  const diag = gaze({ x: -500, y: -500 }, { x: 0, y: 0 }, 9);
  close(Math.hypot(diag.x, diag.y), 9);
  assert.ok(diag.x < 0 && diag.y < 0);
});

test("approach: frame-rate independent (60Hz and 120Hz land in the same place)", () => {
  let a = 0, b = 0;
  for (let i = 0; i < 60; i++) a = approach(a, 10, 14, 1 / 60);
  for (let i = 0; i < 120; i++) b = approach(b, 10, 14, 1 / 120);
  close(a, b, 1e-9);
  close(approach(0, 10, 14, 1 / 30), approach(approach(0, 10, 14, 1 / 60), 10, 14, 1 / 60));
});

test("paw spring: ~4% overshoot and settled within ~0.35s, stable on a long frame", () => {
  let s = { x: 0, v: 0 }, peak = 0, settledAt = -1;
  for (let t = 0; t < 1; t += 1 / 120) {
    s = springStep(s, 1, PAW_SPRING.stiffness, PAW_SPRING.damping, 1 / 120);
    peak = Math.max(peak, s.x);
    if (settledAt < 0 && Math.abs(s.x - 1) < 0.02 && Math.abs(s.v) < 0.2) settledAt = t;
  }
  assert.ok(peak > 1.02 && peak < 1.06, `overshoot ${((peak - 1) * 100).toFixed(1)}%`);
  assert.ok(settledAt > 0 && settledAt < 0.4, `settled at ${settledAt.toFixed(3)}s`);
  const jump = springStep({ x: 0, v: 0 }, 1, PAW_SPRING.stiffness, PAW_SPRING.damping, 0.5); // a dropped half second
  assert.ok(Number.isFinite(jump.x) && Math.abs(jump.x - 1) < 0.2);
});
