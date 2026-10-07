import { isProvider, keyFormatError, PROVIDERS } from "@/lib/provider-keys";
import { keyStatuses, seal, vaultEnabled } from "@/lib/server/key-vault";
import { accountFrom, admin, RATE_RETRY_AFTER_S, rateLimited, settleAccount, type Account } from "@/lib/server/supabase";

const json = (body: unknown, status = 200) => Response.json(body, { status });

type Gate = { account: Account } | { error: Response };

/** Writes: a permanent account (a guest's key would be lost with the guest), under the shared rate limit. */
async function writer(req: Request): Promise<Gate> {
  if (!admin) return { error: json({ error: "Server is not configured" }, 503) };
  const account = await accountFrom(req);
  if (!account) return { error: json({ error: "Unauthorized" }, 401) };
  if (!account.permanent) return { error: json({ error: "Sign in to add your own keys." }, 403) };
  if (!vaultEnabled) return { error: json({ error: "Custom keys aren't enabled on this server." }, 409) };
  if (await rateLimited(req, account.id)) {
    return { error: Response.json({ error: "Too many requests. Try again in a few minutes." }, { status: 429, headers: { "retry-after": String(RATE_RETRY_AFTER_S) } }) };
  }
  return { account };
}

/** Account summary, lifetime usage, and which providers have a saved key (last 4 characters only, never the key). */
export async function GET(req: Request) {
  if (!admin) return json({ error: "Server is not configured" }, 503);
  const account = await accountFrom(req);
  if (!account) return json({ error: "Unauthorized" }, 401);
  const [balance, stats, keys] = await Promise.all([
    settleAccount(account),
    admin.rpc("account_stats", { p_user: account.id }).single(),
    keyStatuses(account.id),
  ]);
  if (stats.error) return json({ error: `Could not load usage: ${stats.error.message}` }, 500);
  return json({ permanent: account.permanent, balance, stats: stats.data, keys, byok: vaultEnabled });
}

/** Save (or replace) one provider key: format-checked here, encrypted, then stored. */
export async function PUT(req: Request) {
  const gate = await writer(req);
  if ("error" in gate) return gate.error;
  const { provider, key } = ((await req.json().catch(() => null)) ?? {}) as { provider?: unknown; key?: unknown };
  if (!isProvider(provider)) return json({ error: "Unknown provider" }, 400);
  if (typeof key !== "string" || key.length > 200) return json({ error: `That doesn't look like a ${PROVIDERS[provider].label} key.` }, 400);
  const problem = keyFormatError(provider, key);
  if (problem) return json({ error: problem }, 400);

  const k = key.trim();
  const userId = gate.account.id;
  const { error } = await admin!
    .from("provider_keys")
    .upsert({ user_id: userId, provider, secret: seal(k, userId, provider), hint: k.slice(-4), updated_at: new Date().toISOString() });
  if (error) {
    console.error("[api] saving provider key failed", error.message); // never log the key
    return json({ error: "Could not save the key. Try again." }, 500);
  }
  return json({ keys: await keyStatuses(userId) });
}

/** Remove one provider key: renders go back to the shared studio keys. */
export async function DELETE(req: Request) {
  const gate = await writer(req);
  if ("error" in gate) return gate.error;
  const provider = new URL(req.url).searchParams.get("provider");
  if (!isProvider(provider)) return json({ error: "Unknown provider" }, 400);
  const { error } = await admin!.from("provider_keys").delete().eq("user_id", gate.account.id).eq("provider", provider);
  if (error) return json({ error: `Could not remove the key: ${error.message}` }, 500);
  return json({ keys: await keyStatuses(gate.account.id) });
}
