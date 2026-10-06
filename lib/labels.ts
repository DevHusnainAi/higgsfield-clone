// Human labels for parsed intents. Plain module (no "use client"), so server code such as the
// Open Graph image can use the same wording as the UI.
import { estimateCost } from "./generation.ts";
import type { Intent } from "./intent.ts";

export const title = (s: string) => (s === "fpv" ? "FPV drone" : s.charAt(0).toUpperCase() + s.slice(1).replace("-", " "));

/** What the parser reads from a prompt, most important first; tiles show at most 4 (cost drops first, then duration). */
export function intentLabels(intent: Intent): string[] {
  return [
    title(intent.media),
    intent.camera && title(intent.camera),
    intent.aspectRatio,
    intent.durationSec && `${intent.durationSec}s`,
    `${estimateCost(intent)} credits`,
  ].filter((x): x is string => !!x);
}
