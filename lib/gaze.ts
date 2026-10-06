// Pure motion maths for the sign-in creature (Iris). No DOM, so it's unit-tested.

export interface Vec {
  x: number;
  y: number;
}

/**
 * Where a pupil should sit to look at a point: along the direction to it, at most `maxR` from the eye's
 * centre, reaching the rim only once the point is `reach` px away (so nearby targets give small glances).
 */
export function gaze(target: Vec, eye: Vec, maxR: number, reach = 300): Vec {
  const dx = target.x - eye.x;
  const dy = target.y - eye.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return { x: 0, y: 0 };
  const r = maxR * Math.min(1, dist / reach);
  return { x: (dx / dist) * r, y: (dy / dist) * r };
}

/**
 * Exponential smoothing toward `target`, independent of frame rate: one step of 2·dt equals two steps of dt.
 * `rate` is per second (14 ≈ a 70ms response). The naive `x += (t - x) * k` drifts with refresh rate.
 */
export const approach = (current: number, target: number, rate: number, dt: number) =>
  target + (current - target) * Math.exp(-rate * dt);

export interface Spring {
  x: number;
  v: number;
}

/** Damped spring (unit mass), semi-implicit Euler with ≤ 1/120 s sub-steps so long frames stay stable. */
export function springStep(s: Spring, target: number, stiffness: number, damping: number, dt: number): Spring {
  let { x, v } = s;
  const steps = Math.max(1, Math.ceil(dt * 120));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    v += (-stiffness * (x - target) - damping * v) * h;
    x += v * h;
  }
  return { x, v };
}

/** The paws' spring: ~4% overshoot, settled in ~320ms. */
export const PAW_SPRING = { stiffness: 300, damping: 25 } as const;
