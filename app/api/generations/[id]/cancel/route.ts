import { abortRender } from "@/lib/server/run-generation";
import { admin, toGeneration, userIdFrom, type GenerationRow } from "@/lib/server/supabase";

const json = (body: unknown, status = 200) => Response.json(body, { status });

/** Cancel your own running generation; its held credits are refunded. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!admin) return json({ error: "Server is not configured" }, 503);
  const userId = await userIdFrom(req);
  if (!userId) return json({ error: "Unauthorized" }, 401);
  const { id } = await ctx.params;

  const owned = await admin.from("generations").select("id").eq("id", id).eq("user_id", userId).maybeSingle();
  if (!owned.data) return json({ error: "Not found" }, 404);

  await admin.rpc("fail_generation", { p_id: id, p_reason: "cancelled" });
  abortRender(id);

  const [{ data: row }, { data: balance }] = await Promise.all([
    admin.from("generations").select("*").eq("id", id).single(),
    admin.rpc("get_balance", { p_user: userId }),
  ]);
  return json({ generation: toGeneration(row as GenerationRow), balance });
}
