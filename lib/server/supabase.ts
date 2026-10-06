// Server-only: service-role client, request auth, and DB row -> Generation mapping.
// The secret key has no NEXT_PUBLIC_ prefix, so it never reaches the browser bundle.
import { createClient } from "@supabase/supabase-js";
import type { FailureReason, Generation } from "../generation.ts";
import type { Intent } from "../intent.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;

export const BUCKET = "generations";
export const REFERENCES = "references";

export const admin = url && secret ? createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

/** Verifies the caller's Supabase access token. Returns the user id, or null. */
export async function userIdFrom(req: Request): Promise<string | null> {
  const token = req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!admin || !token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error) console.error(`[api] access token rejected: ${error.message}${error.code ? ` (${error.code})` : ""}`);
  return error ? null : data.user.id;
}

export interface GenerationRow {
  id: string;
  user_id: string;
  intent: Intent;
  batch_id: string | null;
  batch_index: number;
  status: Generation["status"];
  progress: number;
  credits_amount: number;
  failure_reason: FailureReason | null;
  result_path: string | null;
  refunded_at: string | null;
  created_at: string;
  updated_at: string;
}

export function toGeneration(r: GenerationRow): Generation {
  const base = { id: r.id, intent: r.intent, batchId: r.batch_id ?? undefined, createdAt: Date.parse(r.created_at), updatedAt: Date.parse(r.updated_at) };
  const amount = r.credits_amount;
  switch (r.status) {
    case "queued":
      return { ...base, status: "queued", queuePosition: 1, credits: { amount, state: "held" } };
    case "generating":
      return { ...base, status: "generating", progress: r.progress, credits: { amount, state: "held" } };
    case "done":
      return {
        ...base,
        status: "done",
        resultUrl: `${url}/storage/v1/object/public/${BUCKET}/${r.result_path}`,
        credits: { amount, state: "charged" },
      };
    case "failed":
      return {
        ...base,
        status: "failed",
        reason: r.failure_reason ?? "provider_error",
        credits: { amount, state: "refunded", refundedAt: Date.parse(r.refunded_at ?? r.updated_at) },
      };
  }
}

const RATE_MAX = 15;
const RATE_WINDOW = "10 minutes";
export const RATE_RETRY_AFTER_S = 600;

/**
 * True when this user or this IP has used up RATE_MAX write requests in RATE_WINDOW. Fails closed.
 * The IP key caps farming of fresh anonymous accounts from one machine.
 * ponytail: trusts the first x-forwarded-for hop, which the host (Vercel) sets; behind another proxy, read that proxy's header instead
 */
export async function rateLimited(req: Request, userId: string): Promise<boolean> {
  if (!admin) return true;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim();
  for (const key of [`user:${userId}`, ...(ip ? [`ip:${ip}`] : [])]) {
    const { data, error } = await admin.rpc("rate_limit_hit", { p_key: key, p_max: RATE_MAX, p_window: RATE_WINDOW });
    if (error) console.error("[api] rate limit check failed (is the migration applied?)", error.message);
    if (error || data) return true;
  }
  return false;
}
