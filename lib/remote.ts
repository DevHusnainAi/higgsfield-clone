// Browser side of the Supabase backend: an anonymous session + authenticated calls to our API routes.
// Without NEXT_PUBLIC_SUPABASE_* env vars the store runs fully local (simulated renders).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const remoteEnabled = Boolean(url && key);

/**
 * Why a sync failed. `retry` says whether trying again on a timer can help:
 * network blips and 5xx can; disabled anonymous sign-in or missing server keys can't until someone fixes config.
 */
export class SyncError extends Error {
  constructor(
    readonly kind: "auth" | "config" | "unauthorized" | "network" | "server",
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
  }
  get retry() {
    return this.kind === "network" || this.kind === "server";
  }
}

const AUTH_HINTS: Record<string, string> = {
  anonymous_provider_disabled: "Anonymous sign-ins are off. Turn them on in Supabase: Authentication > Sign In / Providers.",
  signup_disabled: "New sign-ups are disabled in Supabase, which also blocks anonymous sign-ins.",
  over_request_rate_limit: "Too many sign-in attempts from this network. Wait a minute and retry.",
};

let client: SupabaseClient | null = null;

// ponytail: anonymous sign-in per browser; add email/OAuth linking when accounts need to roam devices
async function accessToken(): Promise<string> {
  client ??= createClient(url!, key!);
  try {
    const { data, error } = await client.auth.getSession(); // refreshes an expired token
    if (error) throw error;
    if (data.session) return data.session.access_token;
    const anon = await client.auth.signInAnonymously();
    if (anon.error || !anon.data.session) throw anon.error ?? new Error("No session returned");
    return anon.data.session.access_token;
  } catch (err) {
    const e = err as { code?: string; status?: number; message?: string; name?: string };
    if (e.name === "AuthRetryableFetchError" || err instanceof TypeError) {
      throw new SyncError("network", `Can't reach Supabase at ${url}.`, err);
    }
    throw new SyncError("auth", AUTH_HINTS[e.code ?? ""] ?? `Supabase sign-in failed: ${e.message ?? "unknown error"}${e.code ? ` (${e.code})` : ""}.`, err);
  }
}

const STATUS_ERRORS: Record<number, [SyncError["kind"], string]> = {
  401: ["unauthorized", "The server rejected this session. Check that the server's SUPABASE_SECRET_KEY belongs to the same project as NEXT_PUBLIC_SUPABASE_URL."],
  503: ["config", "The server is missing SUPABASE_SECRET_KEY or NEXT_PUBLIC_SUPABASE_URL. Add them to .env.local and restart."],
};

/** Authenticated JSON call. Throws SyncError for transport/auth/config failures; returns other statuses (e.g. 402) to the caller. */
export async function api<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T }> {
  const token = await accessToken();
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${token}` } });
  } catch (err) {
    throw new SyncError("network", "Offline: can't reach the studio server.", err);
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  const known = STATUS_ERRORS[res.status];
  if (known) throw new SyncError(known[0], known[1], { status: res.status, body: data });
  if (res.status >= 500) throw new SyncError("server", `Server error (${res.status}): ${data.error ?? "no details"}.`, { status: res.status, body: data });
  return { ok: res.ok, status: res.status, data };
}
