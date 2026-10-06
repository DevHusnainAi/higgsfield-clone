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
} as const satisfies Record<string, ModelSpec>;

export type ModelId = keyof typeof MODELS;

export const DEFAULT_MODEL: Record<MediaType, ModelId> = { image: "sd3-medium", video: "wan-2.2-5b" };

export const isModelId = (v: unknown): v is ModelId => typeof v === "string" && Object.hasOwn(MODELS, v);

export function modelsFor(media: MediaType): [ModelId, ModelSpec][] {
  return (Object.entries(MODELS) as [ModelId, ModelSpec][]).filter(([, m]) => m.media === media);
}

export const MAX_SEED = 2 ** 32 - 1;
