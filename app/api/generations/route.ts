import { after } from "next/server";
import { estimateCost } from "@/lib/generation";
import { parseIntent } from "@/lib/intent";
import { runGeneration } from "@/lib/server/run-generation";
import { admin, toGeneration, userIdFrom, type GenerationRow } from "@/lib/server/supabase";

// The render runs in after(); this caps it (see RENDER_TIMEOUT_MS).
export const maxDuration = 300;

const STALE_AFTER = "10 minutes";

const json = (body: unknown, status = 200) => Response.json(body, { status });

async function balanceOf(userId: string): Promise<number> {
  const { data } = await admin!.rpc("get_balance", { p_user: userId });
  return data as number;
}

/** Your generations (newest first) and credit balance. */
export async function GET(req: Request) {
  if (!admin) return json({ error: "Server is not configured" }, 503);
  const userId = await userIdFrom(req);
  if (!userId) return json({ error: "Unauthorized" }, 401);

  await admin.rpc("fail_stale_generations", { p_user: userId, p_max_age: STALE_AFTER });
  const { data, error } = await admin
    .from("generations")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return json({ error: "Could not load generations" }, 500);

  return json({ runs: (data as GenerationRow[]).map(toGeneration), balance: await balanceOf(userId) });
}

/** Start a generation. The intent and cost are computed here; the client only sends the prompt. */
export async function POST(req: Request) {
  if (!admin) return json({ error: "Server is not configured" }, 503);
  const userId = await userIdFrom(req);
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const body: unknown = await req.json().catch(() => null);
  const intent = parseIntent((body as { prompt?: unknown })?.prompt);
  if (!intent.prompt) return json({ error: "Prompt is empty" }, 400);
  const cost = estimateCost(intent);

  const { data, error } = await admin.rpc("start_generation", { p_user: userId, p_intent: intent, p_cost: cost });
  if (error) {
    if (error.message.includes("insufficient_credits")) {
      return json({ error: "insufficient_credits", cost, balance: await balanceOf(userId) }, 402);
    }
    return json({ error: "Could not start generation" }, 500);
  }

  const row = data as GenerationRow;
  after(() => runGeneration(row));
  return json({ generation: toGeneration(row), balance: await balanceOf(userId) }, 201);
}
