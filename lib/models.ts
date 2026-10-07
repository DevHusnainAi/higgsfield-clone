// Model registry shared by client (pricing, Advanced panel) and server (rendering).
// ponytail: credit rates are a mock rate card; derive them from provider pricing when billing is real
import type { MediaType } from "./intent.ts";

export interface ModelSpec {
  label: string;
  media: MediaType;
  /** The model id at its provider: a Hugging Face id for HF Inference Providers, a "@cf/..." id for Cloudflare. */
  hfId: string;
  /** cloudflare = Workers AI on the studio's account: the free tier's image model (see FREE_TIER_IMAGE_MODEL). */
  provider: "hf-inference" | "fal-ai" | "cloudflare";
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
  // Free tier: Cloudflare's FLUX takes no width/height, and the aspect ratio chips need them.
  "sdxl-lightning": {
    label: "SDXL Lightning",
    media: "image",
    hfId: "@cf/bytedance/stable-diffusion-xl-lightning",
    provider: "cloudflare",
    credits: 4, // same as the SD3 default it stands in for, so a price shown before the tier is known still holds
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

/**
 * Which image models a user can render. `free`: no saved HF key, and Cloudflare configured on the server, so images
 * render on Cloudflare (the shared HF account is out of credit). `fal`: a saved fal key, which still runs FLUX.
 * Videos are unaffected: they go to the user's keys, or the shared keys and their 402 fallback.
 */
export interface Tier {
  free: boolean;
  fal: boolean;
}
export const DEFAULT_TIER: Tier = { free: false, fal: false };
export const FREE_TIER_IMAGE_MODEL: ModelId = "sdxl-lightning";

/** Whether `id` can render on this tier. Free tier: images on Cloudflare, plus fal models on a saved fal key. */
export function availableOn(id: ModelId, tier: Tier): boolean {
  const m: ModelSpec = MODELS[id];
  return !tier.free || m.media !== "image" || m.provider === "cloudflare" || (m.provider === "fal-ai" && tier.fal);
}

export const isModelId = (v: unknown): v is ModelId => typeof v === "string" && Object.hasOwn(MODELS, v);

/** Models that can render `media`, with or without a start frame attached, on this tier. */
export function modelsFor(media: MediaType, startFrame = false, tier = DEFAULT_TIER): [ModelId, ModelSpec][] {
  return (Object.entries(MODELS) as [ModelId, ModelSpec][]).filter(
    ([id, m]) => m.media === media && Boolean(m.startFrame) === startFrame && availableOn(id, tier),
  );
}

export const MAX_SEED = 2 ** 32 - 1;
