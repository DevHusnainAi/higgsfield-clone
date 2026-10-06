// Rule-based prompt -> generation settings, plus manual overrides. Pure, never throws.
// The server runs the same function on untrusted overrides, so every value is re-validated here.
// ponytail: regex rules, not NLP; swap the detection half for an LLM call if rules stop scaling
import { DEFAULT_MODEL, isModelId, MAX_SEED, MODELS, type ModelId } from "./models.ts";

export type MediaType = "image" | "video";

export const CAMERA_MOVES = [
  "dolly-in", "dolly-out", "pan", "pan-left", "pan-right", "tilt-up", "tilt-down", "zoom-in", "zoom-out",
  "crane-up", "crane-down", "orbit", "tracking", "handheld", "fpv", "static",
] as const;
export type CameraMove = (typeof CAMERA_MOVES)[number];

export const ASPECT_RATIOS = ["1:1", "4:5", "3:4", "2:3", "9:16", "16:9", "4:3", "3:2", "21:9"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export type IntentField = "media" | "camera" | "aspectRatio" | "durationSec";

export interface IntentWarning {
  field: IntentField | "prompt" | "model" | "guidanceScale";
  message: string;
}

/** What a user can set by hand. A key that is absent means "let the prompt decide". */
export interface IntentOverrides {
  media?: MediaType;
  camera?: CameraMove | null;
  aspectRatio?: AspectRatio;
  durationSec?: number;
  model?: ModelId;
  seed?: number | null;
  guidanceScale?: number | null;
  count?: number;
}
export const OVERRIDE_KEYS = ["media", "camera", "aspectRatio", "durationSec", "model", "seed", "guidanceScale", "count"] as const;

export interface Intent {
  /** Trimmed prompt, capped at MAX_PROMPT_LENGTH. */
  prompt: string;
  media: MediaType;
  camera: CameraMove | null;
  aspectRatio: AspectRatio;
  /** Seconds of output; null for images. */
  durationSec: number | null;
  model: ModelId;
  /** null = random. */
  seed: number | null;
  /** null = model default. */
  guidanceScale: number | null;
  /** Outputs in one run (COUNT.min-COUNT.max). Each output is its own generation. */
  count: number;
  /** Prompt text each field was read from. Missing key = not from the prompt. */
  matched: Partial<Record<IntentField, string>>;
  /** Adjustments the user should see instead of having them happen silently. */
  warnings: IntentWarning[];
}

export const MAX_PROMPT_LENGTH = 4000;
// Model limits (Wan 2.2 5B on fal: 17-161 frames at 24fps; 16:9, 9:16 or 1:1 only).
export const DURATION = { min: 2, max: 6, default: 5 } as const;
export const VIDEO_RATIOS: readonly AspectRatio[] = ["16:9", "9:16", "1:1"];
export const COUNT = { min: 1, max: 4 } as const;

type Rule<T> = readonly [RegExp, T];

// Every rule needs camera context ("pan left", "tracking shot") so nouns like "frying pan" don't match.
const CAMERA_RULES: Rule<CameraMove>[] = [
  [/\b(?:(?:slow|camera) )?(?:dolly(?:ing)?|push(?:es|ing)?) in(?:to|wards?)?\b/g, "dolly-in"],
  [/\b(?:(?:slow|camera) )?(?:dolly(?:ing)?|pull(?:s|ing)?) (?:out|back)\b/g, "dolly-out"],
  [/\b(?:(?:whip|slow|camera) )?pan(?:s|ning)? (?:to the )?left\b/g, "pan-left"],
  [/\b(?:(?:whip|slow|camera) )?pan(?:s|ning)? (?:to the )?right\b/g, "pan-right"],
  [/\b(?:whip|slow|camera) pan\b|\bpan(?:ning)? (?:shot|across)\b|\bpanning\b/g, "pan"],
  [/\b(?:(?:slow|camera) )?tilt(?:s|ing)? up\b/g, "tilt-up"],
  [/\b(?:(?:slow|camera) )?tilt(?:s|ing)? down\b/g, "tilt-down"],
  [/\b(?:(?:crash|slow) )?zoom(?:s|ing)? in(?:to)?\b|\bcrash zoom\b/g, "zoom-in"],
  [/\b(?:slow )?zoom(?:s|ing)? out\b/g, "zoom-out"],
  [/\b(?:crane|jib|boom) (?:up|shot|rising)\b/g, "crane-up"],
  [/\b(?:crane|jib|boom) down\b/g, "crane-down"],
  [/\b(?:orbit|arc) shot\b|\borbiting camera\b|\b(?:camera|slow) orbit(?:s|ing)?\b|\b360(?: degree)? (?:orbit|spin|shot|rotation)\b/g, "orbit"],
  [/\b(?:tracking|follow(?:ing)?) (?:shot|camera)\b/g, "tracking"],
  [/\bhand ?held\b|\bshaky cam(?:era)?\b/g, "handheld"],
  [/\bfpv\b|\bdrone (?:shot|footage|flyover|fly ?through)\b/g, "fpv"],
  [/\b(?:static|locked off|fixed) (?:camera|shot)\b|\btripod shot\b/g, "static"],
];

const VIDEO_WORDS: Rule<"video">[] = [
  [/\b(?:videos?|clips?|footage|animation|animate|time ?lapse|slow motion|slo mo|cinemagraph)\b/g, "video"],
];
const IMAGE_WORDS: Rule<"image">[] = [
  [/\b(?:photos?|photograph(?:y)?|images?|pictures?|pic|still (?:image|frame)|poster|illustration|wallpaper|headshot|portrait)\b/g, "image"],
];

const ASPECT_WORDS: Rule<AspectRatio>[] = [
  [/\bsquare (?:format|crop|frame|aspect|ratio|image|photo|video|shot)\b/g, "1:1"],
  [/\b(?:vertical (?:format|video|shot|frame|orientation|aspect)|portrait (?:format|orientation|mode|aspect)|(?:tiktok|instagram|ig|youtube) (?:reels?|story|stories|shorts?))\b/g, "9:16"],
  [/\b(?:wide ?screen|landscape (?:format|orientation|mode|aspect)|horizontal (?:format|video|frame))\b/g, "16:9"],
  [/\b(?:anamorphic|cinemascope|scope (?:format|aspect))\b/g, "21:9"],
];

// ":" only; "x" and "/" collide with "2x3 grid" and "2/3 of the frame".
const RATIO = /\b(\d{1,2}) ?: ?(\d{1,2})\b/g;
const DURATION_RE = /\b(\d{1,3}(?:\.\d+)?) ?(s|secs?|seconds?)\b/g;
const NEGATION = /\b(?:no|not|without|avoid|never|dont|do not)\s+(?:\w+\s+)?$/;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[-‐‑–—_°]/g, " ")
    .replace(/\s+/g, " ");
}

/** "without zooming in", "no slow pan left": the match is ruled out. */
function isNegated(text: string, index: number): boolean {
  return NEGATION.test(text.slice(Math.max(0, index - 24), index));
}

interface Hit<T> {
  value: T;
  text: string;
  index: number;
}

/** Earliest non-negated match across rules; on a tie, the longest (so "zoom out" beats "zoom"). */
function firstHit<T>(text: string, rules: readonly Rule<T>[]): Hit<T> | null {
  let best: Hit<T> | null = null;
  for (const [re, value] of rules) {
    for (const m of text.matchAll(re)) {
      if (isNegated(text, m.index)) continue;
      if (!best || m.index < best.index || (m.index === best.index && m[0].length > best.text.length)) {
        best = { value, text: m[0], index: m.index };
      }
      break;
    }
  }
  return best;
}

function findRatio(text: string): Hit<AspectRatio> | null {
  for (const m of text.matchAll(RATIO)) {
    const ratio = `${Number(m[1])}:${Number(m[2])}`;
    if ((ASPECT_RATIOS as readonly string[]).includes(ratio)) {
      return { value: ratio as AspectRatio, text: m[0], index: m.index };
    }
  }
  return null;
}

function findDuration(text: string): Hit<number> | null {
  for (const m of text.matchAll(DURATION_RE)) {
    const n = Number(m[1]);
    // Bare "s" after a round decade is "the 90s", not 90 seconds.
    if (m[2] === "s" && n >= 20 && n % 10 === 0) continue;
    if (isNegated(text, m.index) || !Number.isFinite(n) || n <= 0) continue;
    return { value: n, text: m[0], index: m.index };
  }
  return null;
}

/** Keeps only well-formed override values; anything else is dropped (treated as "auto"). */
export function sanitizeOverrides(input: unknown): IntentOverrides {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: IntentOverrides = {};
  if (o.media === "image" || o.media === "video") out.media = o.media;
  if (o.camera === null || (CAMERA_MOVES as readonly unknown[]).includes(o.camera)) out.camera = o.camera as CameraMove | null;
  if ((ASPECT_RATIOS as readonly unknown[]).includes(o.aspectRatio)) out.aspectRatio = o.aspectRatio as AspectRatio;
  if (Number.isInteger(o.durationSec)) out.durationSec = o.durationSec as number;
  if (isModelId(o.model)) out.model = o.model;
  if (o.seed === null || (Number.isInteger(o.seed) && (o.seed as number) >= 0 && (o.seed as number) <= MAX_SEED)) out.seed = o.seed as number | null;
  if (o.guidanceScale === null || (typeof o.guidanceScale === "number" && Number.isFinite(o.guidanceScale))) out.guidanceScale = o.guidanceScale;
  if (Number.isInteger(o.count)) out.count = o.count as number;
  return out;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function parseIntent(input: unknown, overridesInput?: unknown): Intent {
  const o = sanitizeOverrides(overridesInput);
  const raw = typeof input === "string" ? input.trim() : "";
  const warnings: IntentWarning[] = [];
  const warn = (field: IntentWarning["field"], message: string) => warnings.push({ field, message });
  const prompt = raw.slice(0, MAX_PROMPT_LENGTH);
  if (raw.length > MAX_PROMPT_LENGTH) warn("prompt", `Prompt trimmed to ${MAX_PROMPT_LENGTH} characters.`);

  const text = normalize(prompt);
  const matched: Intent["matched"] = {};

  const video = firstHit(text, VIDEO_WORDS);
  const image = firstHit(text, IMAGE_WORDS);
  const camera = firstHit(text, CAMERA_RULES);
  const duration = findDuration(text);

  // Precedence: explicit video word or a duration > explicit image word > camera move implies video > image.
  let media: MediaType = "image";
  if (video ?? duration) {
    media = "video";
    matched.media = (video ?? duration)!.text;
  } else if (image) {
    matched.media = image.text;
  } else if (camera) {
    media = "video";
    matched.media = camera.text;
  }
  if (o.media) media = o.media;

  let cameraMove: CameraMove | null = null;
  if (media === "video") {
    if (o.camera !== undefined) cameraMove = o.camera;
    else if (camera) cameraMove = camera.value;
    if (camera) matched.camera = camera.text;
  } else if (camera && o.camera === undefined) {
    warn("camera", `Ignored "${camera.text}": camera moves only apply to video.`);
  }

  let durationSec: number | null = null;
  if (media === "video") {
    if (duration) matched.durationSec = duration.text;
    const wanted = o.durationSec ?? (duration ? Math.round(duration.value) : DURATION.default);
    durationSec = clamp(wanted, DURATION.min, DURATION.max);
    if (durationSec !== (o.durationSec ?? duration?.value ?? durationSec)) {
      warn("durationSec", `Duration set to ${durationSec}s (supported: ${DURATION.min}-${DURATION.max}s).`);
    }
  }

  const aspect = findRatio(text) ?? firstHit(text, ASPECT_WORDS);
  if (aspect) matched.aspectRatio = aspect.text;
  let aspectRatio: AspectRatio = o.aspectRatio ?? aspect?.value ?? (media === "video" ? "16:9" : "1:1");
  if (media === "video" && !VIDEO_RATIOS.includes(aspectRatio)) {
    const [w, h] = aspectRatio.split(":").map(Number);
    const fitted = w > h ? "16:9" : "9:16";
    warn("aspectRatio", `Video supports 16:9, 9:16 or 1:1, so ${aspectRatio} became ${fitted}.`);
    aspectRatio = fitted;
  }

  let model = DEFAULT_MODEL[media];
  if (o.model && MODELS[o.model].media === media) model = o.model;
  else if (o.model) warn("model", `${MODELS[o.model].label} makes ${MODELS[o.model].media}s, so ${MODELS[model].label} is used.`);

  let guidanceScale: number | null = null;
  const range = MODELS[model].guidance;
  if (o.guidanceScale != null && !range) {
    warn("guidanceScale", `${MODELS[model].label} has no guidance setting.`);
  } else if (o.guidanceScale != null && range) {
    guidanceScale = clamp(o.guidanceScale, range.min, range.max);
    if (guidanceScale !== o.guidanceScale) warn("guidanceScale", `Guidance set to ${guidanceScale} (supported: ${range.min}-${range.max}).`);
  }

  return {
    prompt,
    media,
    camera: cameraMove,
    aspectRatio,
    durationSec,
    model,
    seed: o.seed ?? null,
    guidanceScale,
    count: clamp(o.count ?? COUNT.min, COUNT.min, COUNT.max),
    matched,
    warnings,
  };
}

/** Overrides that rebuild `intent` from its prompt: only the values the parser wouldn't pick by itself. Seed is dropped so a remix varies. */
export function remixOverrides(intent: Partial<Intent> & { prompt: string }): IntentOverrides {
  const auto = parseIntent(intent.prompt);
  const out: Record<string, unknown> = {};
  for (const key of OVERRIDE_KEYS) {
    if (key === "seed" || intent[key] === undefined || intent[key] === auto[key]) continue;
    // Keep it only if it still changes the result under today's limits (an old 10s run is 6s now either way).
    if (parseIntent(intent.prompt, { ...out, [key]: intent[key] })[key] !== auto[key]) out[key] = intent[key];
  }
  return sanitizeOverrides(out);
}
