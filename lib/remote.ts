// Browser side of the Supabase backend: an anonymous session + authenticated calls to our API routes.
// Without NEXT_PUBLIC_SUPABASE_* env vars the store runs fully local (simulated renders).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const remoteEnabled = Boolean(url && key);

let client: SupabaseClient | null = null;

// ponytail: anonymous sign-in per browser; add email/OAuth linking when accounts need to roam devices
async function accessToken(): Promise<string> {
  client ??= createClient(url!, key!);
  const { data } = await client.auth.getSession(); // refreshes an expired token
  if (data.session) return data.session.access_token;
  const anon = await client.auth.signInAnonymously();
  if (anon.error || !anon.data.session) throw anon.error ?? new Error("Could not start a session");
  return anon.data.session.access_token;
}

export async function api<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${await accessToken()}` },
  });
  return { ok: res.ok, status: res.status, data: (await res.json().catch(() => ({}))) as T };
}
