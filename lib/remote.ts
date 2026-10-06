// Browser side of the Supabase backend: an anonymous session + authenticated calls to our API routes.
// Without NEXT_PUBLIC_SUPABASE_* env vars the store runs fully local (simulated renders).
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

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
async function session(): Promise<Session> {
  client ??= createClient(url!, key!);
  try {
    const { data, error } = await client.auth.getSession(); // refreshes an expired token
    if (error) throw error;
    if (data.session) return data.session;
    const anon = await client.auth.signInAnonymously();
    if (anon.error || !anon.data.session) throw anon.error ?? new Error("No session returned");
    return anon.data.session;
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
  const token = (await session()).access_token;
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

export const REFERENCE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
export const MAX_REFERENCE_BYTES = 5 * 1024 * 1024; // matches the bucket's file_size_limit

/** Uploads a start frame straight to the private references bucket, into this user's folder. Returns its path. */
export async function uploadReference(file: File): Promise<string> {
  const ext = REFERENCE_TYPES[file.type];
  if (!ext) throw new Error("Use a PNG, JPEG or WebP image.");
  if (file.size > MAX_REFERENCE_BYTES) throw new Error("Images can be up to 5 MB.");
  const path = `${(await session()).user.id}/${crypto.randomUUID()}.${ext}`;
  const { error } = await client!.storage.from("references").upload(path, file, { contentType: file.type, upsert: false });
  if (error) {
    throw new Error(/reference_quota_exceeded/.test(error.message) ? `You can keep up to ${MAX_REFERENCES} start frames. Delete one to upload another.` : `Upload failed: ${error.message}`);
  }
  return path;
}

export const MAX_REFERENCES = 10; // enforced by the enforce_reference_quota trigger

/** Your uploaded start frames, newest first, with short-lived links for thumbnails. */
export async function listReferences(): Promise<{ path: string; url: string }[]> {
  const folder = (await session()).user.id;
  const bucket = client!.storage.from("references");
  const { data, error } = await bucket.list(folder, { limit: MAX_REFERENCES, sortBy: { column: "created_at", order: "desc" } });
  if (error) throw error;
  const paths = data.filter((f) => f.id).map((f) => `${folder}/${f.name}`); // id is null for folder placeholders
  if (!paths.length) return [];
  const signed = await bucket.createSignedUrls(paths, 3600);
  if (signed.error) throw signed.error;
  return signed.data.flatMap((d) => (d.path && d.signedUrl ? [{ path: d.path, url: d.signedUrl }] : []));
}

export async function deleteReference(path: string) {
  await session();
  const { error } = await client!.storage.from("references").remove([path]);
  if (error) throw error;
}

/** Short-lived link for showing your own start frame (the bucket is private). */
export async function referencePreviewUrl(path: string): Promise<string> {
  await session();
  const { data, error } = await client!.storage.from("references").createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}
