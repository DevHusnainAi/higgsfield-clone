// Generation lifecycle: queued -> generating -> done | failed (always refunded).
// Credits are held at submit, charged only on success, refunded on any failure.
import type { AspectRatio, Intent } from "./intent";

export type FailureReason = "capacity" | "provider_error" | "timeout" | "cancelled";

interface Base {
  id: string;
  intent: Intent;
  createdAt: number;
  updatedAt: number;
}

export type Generation =
  | (Base & { status: "queued"; queuePosition: number; credits: { amount: number; state: "held" } })
  | (Base & { status: "generating"; progress: number; credits: { amount: number; state: "held" } })
  | (Base & { status: "done"; resultUrl: string; credits: { amount: number; state: "charged" } })
  | (Base & {
      status: "failed";
      reason: FailureReason;
      credits: { amount: number; state: "refunded"; refundedAt: number };
    });

export type GenerationStatus = Generation["status"];

export type GenerationEvent =
  | { type: "queue_update"; position: number }
  | { type: "start" }
  | { type: "progress"; progress: number }
  | { type: "complete"; resultUrl: string }
  | { type: "fail"; reason: FailureReason };

// ponytail: mock rate card; replace with per-model pricing when a real provider is wired in
export const CREDITS = { image: 4, videoPerSecond: 6 } as const;

export function estimateCost(intent: Intent): number {
  return intent.media === "video" ? CREDITS.videoPerSecond * (intent.durationSec ?? 0) : CREDITS.image;
}

export function createGeneration(intent: Intent, now = Date.now()): Generation {
  if (!intent.prompt) throw new RangeError("Cannot generate from an empty prompt.");
  return {
    id: crypto.randomUUID(),
    intent,
    status: "queued",
    queuePosition: 1,
    credits: { amount: estimateCost(intent), state: "held" },
    createdAt: now,
    updatedAt: now,
  };
}

/** Pure reducer. Events that don't apply to the current state (e.g. anything after done/failed) are ignored. */
export function transition(gen: Generation, event: GenerationEvent, now = Date.now()): Generation {
  if (gen.status === "done" || gen.status === "failed") return gen;

  if (event.type === "fail") {
    const { id, intent, createdAt, credits } = gen;
    return {
      id, intent, createdAt,
      updatedAt: now,
      status: "failed",
      reason: event.reason,
      credits: { amount: credits.amount, state: "refunded", refundedAt: now },
    };
  }

  if (gen.status === "queued") {
    if (event.type === "queue_update") return { ...gen, queuePosition: Math.max(1, event.position), updatedAt: now };
    if (event.type === "start") {
      const { id, intent, createdAt, credits } = gen;
      return { id, intent, createdAt, credits, updatedAt: now, status: "generating", progress: 0 };
    }
    return gen;
  }

  // generating
  if (event.type === "progress") {
    const progress = Math.min(1, Math.max(gen.progress, event.progress)); // never moves backwards
    return { ...gen, progress, updatedAt: now };
  }
  if (event.type === "complete") {
    const { id, intent, createdAt, credits } = gen;
    return {
      id, intent, createdAt,
      updatedAt: now,
      status: "done",
      resultUrl: event.resultUrl,
      credits: { amount: credits.amount, state: "charged" },
    };
  }
  return gen;
}

const FAILURE_TEXT: Record<FailureReason, string> = {
  capacity: "The render queue is full right now",
  provider_error: "The model returned an error",
  timeout: "This took longer than our 2 minute limit",
  cancelled: "You cancelled this generation",
};

/** Status line tied to real state and progress, never random filler. */
export function statusMessage(gen: Generation): string {
  switch (gen.status) {
    case "queued":
      return gen.queuePosition > 1 ? `${gen.queuePosition - 1} ahead of you in the queue` : "Next in line";
    case "generating": {
      const { media, camera } = gen.intent;
      const stages =
        media === "video"
          ? ["Reading your prompt", camera ? `Planning the ${camera.replace("-", " ")}` : "Blocking the scene", "Rendering frames", "Smoothing motion", "Encoding video"]
          : ["Reading your prompt", "Composing the shot", "Rendering details", "Upscaling"];
      return stages[Math.min(stages.length - 1, Math.floor(gen.progress * stages.length))];
    }
    case "done":
      return `Done. ${gen.credits.amount} credits used.`;
    case "failed":
      return `${FAILURE_TEXT[gen.reason]}. ${gen.credits.amount} credits returned to your balance.`;
  }
}

// --- Simulation (stand-in for a real backend; emits the same events one would) ---

export const FAILURE_RATE = 0.1;
export const TIMEOUT_MS = 120_000;

const sleepFor = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(signal.reason); }, { once: true });
  });

function mockResultUrl(id: string, ratio: AspectRatio): string {
  const [w, h] = ratio.split(":").map(Number);
  const scale = 1024 / Math.max(w, h);
  return `https://picsum.photos/seed/${id}/${Math.round(w * scale)}/${Math.round(h * scale)}`;
}

export interface SimulateOptions {
  onUpdate?: (gen: Generation) => void;
  signal?: AbortSignal;
  /** Injectable for deterministic tests. */
  random?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export async function simulateGeneration(intent: Intent, opts: SimulateOptions = {}): Promise<Generation> {
  const rand = opts.random ?? Math.random;
  const sleep = opts.sleep ?? sleepFor;
  const startedAt = Date.now();
  let gen = createGeneration(intent);
  const emit = (event: GenerationEvent) => {
    gen = transition(gen, event);
    opts.onUpdate?.(gen);
  };

  try {
    // Queue: 1-3 jobs ahead, ~0.4-1s each.
    let position = 1 + Math.floor(rand() * 3);
    emit({ type: "queue_update", position });
    while (position > 1) {
      await sleep(400 + rand() * 600, opts.signal);
      emit({ type: "queue_update", position: --position });
    }
    await sleep(300 + rand() * 400, opts.signal);
    emit({ type: "start" });

    // Render: images 3-5s, video ~6s + 0.6s per output second, in uneven ticks.
    const total = intent.media === "video" ? 6000 + (intent.durationSec ?? 5) * 600 : 3000 + rand() * 2000;
    const failAt = rand() < FAILURE_RATE ? 0.2 + rand() * 0.6 : null;
    const ticks = 12;
    for (let i = 1; i <= ticks; i++) {
      await sleep((total / ticks) * (0.6 + rand() * 0.8), opts.signal);
      if (Date.now() - startedAt > TIMEOUT_MS) {
        emit({ type: "fail", reason: "timeout" });
        return gen;
      }
      if (failAt !== null && i / ticks >= failAt) {
        emit({ type: "fail", reason: rand() < 0.6 ? "capacity" : "provider_error" });
        return gen;
      }
      emit({ type: "progress", progress: i / ticks });
    }
    emit({ type: "complete", resultUrl: mockResultUrl(gen.id, intent.aspectRatio) });
  } catch (err) {
    emit({ type: "fail", reason: opts.signal?.aborted ? "cancelled" : "provider_error" });
    if (!opts.signal?.aborted) console.error("simulateGeneration failed", err);
  }
  return gen;
}
