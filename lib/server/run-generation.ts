// Server-only: renders one generation on Hugging Face Inference Providers and settles it in the DB.
// Every path ends in complete_generation (charge) or fail_generation (refund); nothing is left held.
import { InferenceClient } from "@huggingface/inference";
import type { FailureReason } from "../generation.ts";
import type { AspectRatio, Intent } from "../intent.ts";
import { DEFAULT_MODEL, MODELS } from "../models.ts";
import { admin, BUCKET, REFERENCES } from "./supabase.ts";

const FPS = 24;
const START_FRAME_FPS = 16; // fal bills Wan A14B by video second at 16fps
/** Must stay under the route's maxDuration so we always get to settle the row. */
export const RENDER_TIMEOUT_MS = 270_000;

// Best-effort cancel for renders running in this server process.
const inFlight = new Map<string, AbortController>();
export const abortRender = (id: string) => inFlight.get(id)?.abort("cancelled");

/** ~1 megapixel at the requested ratio, snapped to multiples of 64 (SD3 requirement). */
function imageSize(ratio: AspectRatio) {
  const [w, h] = ratio.split(":").map(Number);
  const scale = Math.sqrt((1024 * 1024) / (w * h));
  return { width: Math.round((w * scale) / 64) * 64, height: Math.round((h * scale) / 64) * 64 };
}

async function render(intent: Intent, signal: AbortSignal): Promise<Blob> {
  const hf = new InferenceClient(process.env.HF_TOKEN);
  const id = intent.model ?? DEFAULT_MODEL[intent.media];
  const spec = MODELS[id];
  // Only send what the user set; otherwise the provider's own defaults apply.
  const common = {
    ...(intent.seed != null && { seed: intent.seed }),
    ...(intent.guidanceScale != null && spec.guidance && { guidance_scale: intent.guidanceScale }),
  };
  const size = imageSize(intent.aspectRatio);
  const base = { model: spec.hfId, provider: spec.provider, inputs: intent.prompt };

  switch (id) {
    case "sd3-medium":
      return hf.textToImage({ ...base, parameters: { ...size, ...common } }, { signal, outputType: "blob" });
    case "flux-schnell":
      // fal-ai receives parameters as-is (schema: fal.ai/models/fal-ai/flux/schnell/api).
      return hf.textToImage({ ...base, parameters: { image_size: size, ...common } }, { signal, outputType: "blob" });
    case "wan-2.2-5b":
      // fal-ai receives parameters as-is (schema: fal.ai/models/fal-ai/wan/v2.2-5b/text-to-video/api).
      return hf.textToVideo(
        {
          ...base,
          parameters: {
            num_frames: (intent.durationSec ?? 5) * FPS + 1,
            frames_per_second: FPS,
            aspect_ratio: intent.aspectRatio,
            resolution: "720p",
            ...common,
          },
        },
        { signal },
      );
    case "wan-2.2-i2v-a14b": {
      // The frame is read from our private bucket with the service role and sent as bytes:
      // the provider is never handed a URL, and no user-supplied URL is ever fetched.
      const { data: frame, error } = await admin!.storage.from(REFERENCES).download(intent.reference!);
      if (error) throw error;
      // fal-ai receives parameters as-is (schema: fal.ai/models/fal-ai/wan/v2.2-a14b/image-to-video/api).
      return hf.imageToVideo(
        {
          ...base,
          inputs: frame,
          parameters: {
            prompt: intent.prompt,
            num_frames: (intent.durationSec ?? 5) * START_FRAME_FPS + 1,
            frames_per_second: START_FRAME_FPS,
            aspect_ratio: intent.aspectRatio,
            resolution: "720p",
            ...common,
          },
        },
        { signal },
      );
    }
  }
}

function reasonFor(err: unknown, signal: AbortSignal): FailureReason {
  if (signal.aborted) return signal.reason === "cancelled" ? "cancelled" : "timeout";
  const status = (err as { httpResponse?: { status?: number } })?.httpResponse?.status;
  return status === 429 || status === 503 ? "capacity" : "provider_error";
}

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm" };

export async function runGeneration(row: { id: string; user_id: string; intent: Intent }) {
  if (!admin) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort("timeout"), RENDER_TIMEOUT_MS);
  inFlight.set(row.id, ctrl);
  try {
    if (!process.env.HF_TOKEN) throw new Error("HF_TOKEN is not set");
    await admin.rpc("mark_generating", { p_id: row.id, p_progress: 0.05 });
    const blob = await render(row.intent, ctrl.signal);
    await admin.rpc("mark_generating", { p_id: row.id, p_progress: 0.9 });

    const type = blob.type || (row.intent.media === "video" ? "video/mp4" : "image/png");
    const path = `${row.user_id}/${row.id}.${EXT[type] ?? "bin"}`;
    const upload = await admin.storage.from(BUCKET).upload(path, blob, { contentType: type, upsert: true });
    if (upload.error) throw upload.error;

    const { error } = await admin.rpc("complete_generation", { p_id: row.id, p_result_path: path });
    if (error) throw error;
  } catch (err) {
    const reason = reasonFor(err, ctrl.signal);
    if (reason !== "cancelled") console.error(`generation ${row.id} failed (${reason})`, err);
    // No-op if the row was already settled (cancel route got there first).
    await admin.rpc("fail_generation", { p_id: row.id, p_reason: reason });
  } finally {
    clearTimeout(timer);
    inFlight.delete(row.id);
  }
}
