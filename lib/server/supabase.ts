// Server-only: service-role client, request auth, and DB row -> Generation mapping.
// The secret key has no NEXT_PUBLIC_ prefix, so it never reaches the browser bundle.
import { createClient } from "@supabase/supabase-js";
import type { FailureReason, Generation } from "../generation.ts";
import type { Intent } from "../intent.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;

export const BUCKET = "generations";
export const REFERENCES = "references";

/** Postgres role a Supabase API key runs as: new-style keys by prefix, legacy keys by their JWT `role` claim. */
export function keyRole(key: string): string | null {
  if (key.startsWith("sb_secret_")) return "service_role";
  if (key.startsWith("sb_publishable_")) return "anon";
  try {
    return JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role ?? null;
  } catch {
    return null;
  }
}

// A publishable/anon key here makes every query run as `anon`, which the hardening migration locks out
// ("permission denied for table generations"). Refuse it up front: the API then answers 503 "not configured".
const secretOk = !!secret && keyRole(secret) === "service_role";
if (secret && !secretOk) {
  console.error(`[api] SUPABASE_SECRET_KEY is a ${keyRole(secret) ?? "unrecognised"} key, not the secret (service_role) key. Server API disabled.`);
}

export const admin = url && secretOk ? createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

/** A verified user. `permanent` = signed in with email or Google; false for an anonymous session. */
export interface Account {
  id: string;
  permanent: boolean;
}

/** Verifies a Supabase access token with the auth server (never trusts its claims locally). */
export async function accountFor(token: string | undefined): Promise<Account | null> {
  if (!admin || !token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error) console.error(`[api] access token rejected: ${error.message}${error.code ? ` (${error.code})` : ""}`);
  return error ? null : { id: data.user.id, permanent: !data.user.is_anonymous };
}

export const accountFrom = (req: Request) => accountFor(req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1]);

/** Verifies the caller's Supabase access token. Returns the user id, or null. */
export const userIdFrom = async (req: Request) => (await accountFrom(req))?.id ?? null;

/** Creates the credit row on first use and pays the one-time 40-credit grant to permanent accounts. Returns the balance. */
export async function settleAccount(account: Account): Promise<number> {
  const { data, error } = await admin!.rpc("settle_account", { p_user: account.id, p_permanent: account.permanent });
  if (error) throw new Error(`settle_account failed: ${error.message}`);
  return data as number;
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
  /** A storage path, or an absolute URL for a demo-fallback stock asset. */
  result_path: string | null;
  demo_fallback: boolean;
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
    case "done": {
      const resultUrl = r.result_path!.startsWith("https://") ? r.result_path! : `${url}/storage/v1/object/public/${BUCKET}/${r.result_path}`;
      return r.demo_fallback
        ? { ...base, status: "done", resultUrl, demoFallback: true, credits: { amount, state: "refunded", refundedAt: Date.parse(r.refunded_at ?? r.updated_at) } }
        : { ...base, status: "done", resultUrl, credits: { amount, state: "charged" } };
    }
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
