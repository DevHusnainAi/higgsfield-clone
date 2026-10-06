// Rule-based prompt -> generation settings. Pure, never throws.
// ponytail: regex rules, not NLP; swap parseIntent's body for an LLM call if rules stop scaling

export type MediaType = "image" | "video";

export type CameraMove =
  | "dolly-in" | "dolly-out"
  | "pan" | "pan-left" | "pan-right"
  | "tilt-up" | "tilt-down"
  | "zoom-in" | "zoom-out"
  | "crane-up" | "crane-down"
  | "orbit" | "tracking" | "handheld" | "fpv" | "static";

export const ASPECT_RATIOS = ["1:1", "4:5", "3:4", "2:3", "9:16", "16:9", "4:3", "3:2", "21:9"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export type IntentField = "media" | "camera" | "aspectRatio" | "durationSec";

export interface Intent {
  /** Trimmed prompt, capped at MAX_PROMPT_LENGTH. */
  prompt: string;
  media: MediaType;
  camera: CameraMove | null;
  aspectRatio: AspectRatio;
  /** Seconds of output; null for images. */
  durationSec: number | null;
  /** Prompt text each field was read from. Missing key = default value. */
  matched: Partial<Record<IntentField, string>>;
  /** Adjustments the user should see instead of having them happen silently. */
  warnings: string[];
}

export const MAX_PROMPT_LENGTH = 4000;
export const DURATION = { min: 2, max: 15, default: 5 } as const;

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

export function parseIntent(input: unknown): Intent {
  const raw = typeof input === "string" ? input.trim() : "";
  const warnings: string[] = [];
  const prompt = raw.slice(0, MAX_PROMPT_LENGTH);
  if (raw.length > MAX_PROMPT_LENGTH) warnings.push(`Prompt trimmed to ${MAX_PROMPT_LENGTH} characters.`);

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

  let cameraMove: CameraMove | null = null;
  if (camera && media === "video") {
    cameraMove = camera.value;
    matched.camera = camera.text;
  } else if (camera) {
    warnings.push(`Ignored "${camera.text}": camera moves only apply to video.`);
  }

  let durationSec: number | null = null;
  if (media === "video") {
    durationSec = DURATION.default;
    if (duration) {
      durationSec = Math.min(DURATION.max, Math.max(DURATION.min, Math.round(duration.value)));
      matched.durationSec = duration.text;
      if (durationSec !== duration.value) warnings.push(`Duration set to ${durationSec}s (supported: ${DURATION.min}-${DURATION.max}s).`);
    }
  }

  const aspect = findRatio(text) ?? firstHit(text, ASPECT_WORDS);
  if (aspect) matched.aspectRatio = aspect.text;

  return {
    prompt,
    media,
    camera: cameraMove,
    aspectRatio: aspect?.value ?? (media === "video" ? "16:9" : "1:1"),
    durationSec,
    matched,
    warnings,
  };
}
