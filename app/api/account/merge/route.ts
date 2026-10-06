import { accountFor, accountFrom, admin, rateLimited } from "@/lib/server/supabase";

const json = (body: unknown, status = 200) => Response.json(body, { status });

/**
 * Brings an anonymous session's finished history into the permanent account the caller just signed in to.
 * The caller proves both sides: the bearer token is the permanent account, `anonToken` is the anonymous
 * session's access token, saved by the browser before it switched. Credits never move (see the migration).
 */
export async function POST(req: Request) {
  if (!admin) return json({ error: "Server is not configured" }, 503);
  const account = await accountFrom(req);
  if (!account) return json({ error: "Unauthorized" }, 401);
  if (!account.permanent) return json({ error: "Sign in first" }, 403);
  if (await rateLimited(req, account.id)) return json({ error: "Too many requests. Try again in a few minutes." }, 429);

  const { anonToken } = ((await req.json().catch(() => null)) ?? {}) as { anonToken?: unknown };
  const source = typeof anonToken === "string" ? await accountFor(anonToken) : null;
  // Expired (access tokens last about an hour) or forged: nothing to merge, and nothing to retry.
  if (!source) return json({ error: "The guest session expired, so its history can't be moved." }, 410);
  if (source.permanent) return json({ error: "That session isn't a guest session." }, 400);

  const { data, error } = await admin.rpc("merge_anonymous_history", { p_from: source.id, p_to: account.id });
  if (error) {
    console.error("[api] merge_anonymous_history failed", error.message);
    return json({ error: `Could not move history: ${error.message}` }, 500);
  }
  return json({ moved: data as number });
}
