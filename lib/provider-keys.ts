// Bring-your-own-key: which providers, and what their keys look like. Shared by the settings form (instant
// feedback) and the API route (the actual check: the browser's verdict is never trusted).

export type Provider = "hf" | "fal";

export const PROVIDERS: Record<Provider, { label: string; env: string; pattern: RegExp; example: string; covers: string }> = {
  hf: {
    label: "Hugging Face",
    env: "HF_TOKEN",
    // Access tokens: "hf_" + letters and digits (34 today; a range in case the length changes).
    pattern: /^hf_[A-Za-z0-9]{30,64}$/,
    example: "hf_…",
    covers: "Every model, routed and billed through your Hugging Face account.",
  },
  fal: {
    label: "fal.ai",
    env: "FAL_KEY",
    // "<key id (uuid)>:<key secret>"
    pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[A-Za-z0-9]{20,64}$/i,
    example: "key-id:key-secret",
    covers: "FLUX schnell and the Wan video models, billed to fal directly.",
  },
};

export const isProvider = (p: unknown): p is Provider => p === "hf" || p === "fal";

/** Why a pasted key can't be right, or null if its shape is fine. Whitespace from copy-paste is trimmed first. */
export function keyFormatError(provider: Provider, key: string): string | null {
  const k = key.trim();
  if (!k) return "Paste a key first.";
  if (provider === "hf" && !k.startsWith("hf_")) return "Hugging Face tokens start with hf_.";
  if (provider === "fal" && !k.includes(":")) return "fal keys look like key-id:key-secret. Copy the whole key.";
  return PROVIDERS[provider].pattern.test(k) ? null : `That doesn't look like a ${PROVIDERS[provider].label} key.`;
}

/** What the settings page is told about a saved key: never the key itself, only its last 4 characters. */
export interface KeyStatus {
  hint: string;
  updatedAt: string;
}
