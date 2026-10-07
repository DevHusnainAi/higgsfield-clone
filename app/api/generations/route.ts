import { after } from "next/server";
import { estimateCost, splitBatch } from "@/lib/generation";
import { forTier, parseIntent } from "@/lib/intent";
import { DEFAULT_TIER, type Tier } from "@/lib/models";
import { keyStatuses } from "@/lib/server/key-vault";
import { cloudflareConfigured, runGeneration } from "@/lib/server/run-generation";
import { accountFrom, admin, RATE_RETRY_AFTER_S, REFERENCES, rateLimited, settleAccount, toGeneration, type GenerationRow } from "@/lib/server/supabase";

// The render runs in after(); this caps it (see RENDER_TIMEOUT_MS).
export const maxDuration = 300;

const STALE_AFTER = "10 minutes";

const json = (body: unknown, status = 200) => Response.json(body, { status });
const tooMany = (error: string) => Response.json({ error }, { status: 429, headers: { "retry-after": String(RATE_RETRY_AFTER_S) } });

async function balanceOf(userId: string): Promise<number> {
  const { data } = await admin!.rpc("get_balance", { p_user: userId });
  return data as number;
}

/** Free tier: no saved HF key, and Cloudflare is set up to render its images. A saved fal key still runs FLUX. */
async function tierFor(userId: string): Promise<Tier> {
  if (!cloudflareConfigured()) return DEFAULT_TIER;
  const keys = await keyStatuses(userId);
  return { free: !keys.hf, fal: !!keys.fal };
}

/** Your generations (newest first), credit balance, and which image models your keys allow. */
export async function GET(req: Request) {
  if (!admin) return json({ error: "Server is not configured" }, 503);
  const account = await accountFrom(req);
  if (!account) return json({ error: "Unauthorized" }, 401);
  const userId = account.id;
  // Before reading: creates the credit row, and pays the sign-up grant the first time a permanent account shows up.
  const balance = await settleAccount(account);

  const sweep = await admin.rpc("fail_stale_generations", { p_user: userId, p_max_age: STALE_AFTER });
  if (sweep.error) console.error("[api] stale sweep failed (is the migration applied?)", sweep.error.message);
  const { data, error } = await admin
    .from("generations")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .order("batch_index")
    .limit(100);
  if (error) {
    console.error("[api] loading generations failed", error.message);
    return json({ error: `Could not load generations: ${error.message}` }, 500);
  }

  // Re-read: the sweep may have refunded stuck runs since settleAccount.
  return json({
    runs: (data as GenerationRow[]).map(toGeneration),
    balance: sweep.data ? await balanceOf(userId) : balance,
    swept: sweep.data ?? 0,
    tier: await tierFor(userId),
  });
}

/** Start a run of 1-4 outputs. Intent and cost are computed here from the prompt + re-validated overrides. */
export async function POST(req: Request) {
  if (!admin) return json({ error: "Server is not configured" }, 503);
  const account = await accountFrom(req);
  if (!account) return json({ error: "Unauthorized" }, 401);
  const userId = account.id;
  if (await rateLimited(req, userId)) return tooMany("Too many requests. Try again in a few minutes.");

  const body: unknown = await req.json().catch(() => null);
  const { prompt, overrides } = (body ?? {}) as { prompt?: unknown; overrides?: unknown };
  // The model this tier can actually render, decided here before pricing: the charge always matches the model.
  const intent = forTier(parseIntent(prompt, overrides), await tierFor(userId));
  if (!intent.prompt) return json({ error: "Prompt is empty" }, 400);
  // parseIntent already limited reference to "<uuid>/<uuid>.<ext>"; it must be in this user's folder and exist.
  if (intent.reference) {
    const exists = intent.reference.startsWith(`${userId}/`) && (await admin.storage.from(REFERENCES).exists(intent.reference)).data;
    if (!exists) return json({ error: "Start frame not found. Upload it again." }, 400);
  }
  const items = splitBatch(intent);
  const cost = estimateCost(intent);

  await settleAccount(account); // a first action must not create the row at the anonymous default
  // Holds credits for every output in one transaction: all rows are created, or none.
  const rpcStart = performance.now();
  const { data, error } = await admin.rpc("start_generation", { p_user: userId, p_intents: items, p_cost: estimateCost(items[0]) });
  if (error) {
    if (error.message.includes("insufficient_credits")) {
      return json({ error: "insufficient_credits", cost, balance: await balanceOf(userId) }, 402);
    }
    if (error.message.includes("too_many_active")) return tooMany("You already have 3 runs in progress. Wait for one to finish.");
    console.error("[api] start_generation failed", error.message);
    return json({ error: `Could not start generation: ${error.message}` }, 500);
  }

  const rows = (data as GenerationRow[]).sort((a, b) => a.batch_index - b.batch_index);
  // ponytail: one provider call per output, in parallel; the HF client returns only the first image of a batched call
  after(() => Promise.all(rows.map(runGeneration)));
  // Round trip of the locking RPC as seen from this server; surfaced in the client's dev console.
  const timing = { startGenerationMs: Math.round(performance.now() - rpcStart) };
  return json({ generations: rows.map(toGeneration), balance: await balanceOf(userId), timing }, 201);
}
