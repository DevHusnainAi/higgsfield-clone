// Model registry shared by client (pricing, Advanced panel) and server (rendering).
// ponytail: credit rates are a mock rate card; derive them from provider pricing when billing is real
import type { MediaType } from "./intent.ts";

export interface ModelSpec {
  label: string;
  media: MediaType;
  /** Hugging Face model id and the Inference Provider that serves it. */
  hfId: string;
  provider: "hf-inference" | "fal-ai";
  /** Credits per image, or per second of video. */
  credits: number;
  /** null = the model has no guidance setting (distilled models). */
  guidance: { min: number; max: number; default: number } | null;
  /** Animates an uploaded start frame; used exactly when a reference image is attached. */
  startFrame?: true;
}

export const MODELS = {
  "sd3-medium": {
    label: "Stable Diffusion 3 Medium",
    media: "image",
    hfId: "stabilityai/stable-diffusion-3-medium-diffusers",
    provider: "hf-inference",
    credits: 4,
    guidance: { min: 1, max: 15, default: 7 },
  },
  "flux-schnell": {
    label: "FLUX.1 schnell",
    media: "image",
    hfId: "black-forest-labs/FLUX.1-schnell",
    provider: "fal-ai",
    credits: 2,
    guidance: null,
  },
  "wan-2.2-5b": {
    label: "Wan 2.2 5B",
    media: "video",
    hfId: "Wan-AI/Wan2.2-TI2V-5B",
    provider: "fal-ai",
    credits: 6,
    guidance: { min: 1, max: 10, default: 3.5 },
  },
  // The 5B model is text-to-video only on fal via HF; image-to-video goes to the A14B checkpoint.
  "wan-2.2-i2v-a14b": {
    label: "Wan 2.2 A14B (start frame)",
    media: "video",
    hfId: "Wan-AI/Wan2.2-I2V-A14B",
    provider: "fal-ai",
    credits: 8, // a default 5s clip = the 40-credit starter grant
    guidance: { min: 1, max: 10, default: 3.5 },
    startFrame: true,
  },
} as const satisfies Record<string, ModelSpec>;

export type ModelId = keyof typeof MODELS;

export const DEFAULT_MODEL: Record<MediaType, ModelId> = { image: "sd3-medium", video: "wan-2.2-5b" };
export const START_FRAME_MODEL: ModelId = "wan-2.2-i2v-a14b";

export const isModelId = (v: unknown): v is ModelId => typeof v === "string" && Object.hasOwn(MODELS, v);

/** Models that can render `media`, with or without a start frame attached. */
export function modelsFor(media: MediaType, startFrame = false): [ModelId, ModelSpec][] {
  return (Object.entries(MODELS) as [ModelId, ModelSpec][]).filter(([, m]) => m.media === media && Boolean(m.startFrame) === startFrame);
}

export const MAX_SEED = 2 ** 32 - 1;
