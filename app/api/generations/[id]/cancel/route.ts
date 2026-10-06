import { abortRender } from "@/lib/server/run-generation";
import { admin, rateLimited, toGeneration, userIdFrom, type GenerationRow } from "@/lib/server/supabase";

const json = (body: unknown, status = 200) => Response.json(body, { status });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cancel your own running generation; its held credits are refunded. Someone else's id is a 404, never a cancel. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!admin) return json({ error: "Server is not configured" }, 503);
  const userId = await userIdFrom(req);
  if (!userId) return json({ error: "Unauthorized" }, 401);
  if (await rateLimited(req, userId)) return json({ error: "Too many requests. Try again in a few minutes." }, 429);
  const { id } = await ctx.params;
  if (!UUID.test(id)) return json({ error: "Not found" }, 404);

  // Ownership is enforced twice: here, and inside cancel_generation itself.
  const owned = await admin.from("generations").select("id").eq("id", id).eq("user_id", userId).maybeSingle();
  if (!owned.data) return json({ error: "Not found" }, 404);

  await admin.rpc("cancel_generation", { p_id: id, p_user: userId });
  abortRender(id);

  const [{ data: row }, { data: balance }] = await Promise.all([
    admin.from("generations").select("*").eq("id", id).eq("user_id", userId).single(),
    admin.rpc("get_balance", { p_user: userId }),
  ]);
  return json({ generation: toGeneration(row as GenerationRow), balance });
}
