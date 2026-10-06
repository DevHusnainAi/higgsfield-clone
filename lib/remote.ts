// Browser side of the Supabase backend: an anonymous session + authenticated calls to our API routes.
// Without NEXT_PUBLIC_SUPABASE_* env vars the store runs fully local (simulated renders).
import { createClient, type Session, type SupabaseClient, type User } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const remoteEnabled = Boolean(url && key);

/**
 * Why a sync failed. `retry` says whether trying again on a timer can help:
 * network blips and 5xx can; disabled anonymous sign-in or missing server keys can't until someone fixes config.
 */
export class SyncError extends Error {
  readonly kind: "auth" | "config" | "unauthorized" | "network" | "server";
  readonly detail?: unknown;
  constructor(kind: SyncError["kind"], message: string, detail?: unknown) {
    super(message);
    this.kind = kind;
    this.detail = detail;
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
const supabase = () => (client ??= createClient(url!, key!));

// Every visitor starts with an anonymous session; signing in upgrades it in place (see signInWith*).
async function session(): Promise<Session> {
  const client = supabase();
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

/**
 * Authenticated JSON call. Throws SyncError for transport/auth/config failures; returns other statuses (e.g. 402) to the caller.
 * `uid` is the account the request was sent as, so callers can drop replies that arrive after a sign-in/out.
 */
export async function api<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T; uid: string }> {
  const s = await session();
  const token = s.access_token;
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
  return { ok: res.ok, status: res.status, data, uid: s.user.id };
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

// ---- Accounts ----------------------------------------------------------------------------------------
// Upgrading LINKS an email or Google identity to the current anonymous user, so the user id (and with it
// every RLS-scoped row: history, balance, start frames) stays the same. Only when that email/Google account
// already exists do we switch users; the guest token is saved first so /api/account/merge can bring the
// guest's finished history across (never its credits).

export type Auth =
  | { status: "unknown" } // server render and first client render: never differs, so hydration can't mismatch
  | { status: "anonymous"; pendingEmail: string | null }
  | { status: "user"; email: string | null; name: string | null };

const HANDOFF_KEY = "studio.guest-handoff";

function toAuth(user: User): Auth {
  if (user.is_anonymous) return { status: "anonymous", pendingEmail: user.new_email ?? null };
  const meta = user.user_metadata as { full_name?: string; name?: string };
  return { status: "user", email: user.email ?? null, name: meta.full_name ?? meta.name ?? null };
}

const redirectTo = () => window.location.origin;

/** Save the guest's token before switching to an existing account (localStorage: the magic link may open in a new tab). */
async function saveGuest() {
  const s = (await supabase().auth.getSession()).data.session;
  if (s?.user.is_anonymous) localStorage.setItem(HANDOFF_KEY, JSON.stringify({ token: s.access_token, uid: s.user.id }));
}

/** After landing in a different, permanent account: move the guest's history over once. Returns a message for the user, if any. */
async function mergeGuest(user: User): Promise<string | null> {
  let handoff: { token?: string; uid?: string } | null = null;
  try {
    handoff = JSON.parse(localStorage.getItem(HANDOFF_KEY) ?? "null");
  } catch {}
  if (!handoff?.token || handoff.uid === user.id || user.is_anonymous) return null;
  localStorage.removeItem(HANDOFF_KEY);
  try {
    const res = await api<{ moved?: number; error?: string }>("/api/account/merge", { method: "POST", body: JSON.stringify({ anonToken: handoff.token }) });
    if (!res.ok) return res.data.error ?? "Your guest history couldn't be moved.";
    return res.data.moved ? `Moved ${res.data.moved} run${res.data.moved > 1 ? "s" : ""} from your guest session into your account.` : null;
  } catch (err) {
    return err instanceof SyncError ? err.message : "Your guest history couldn't be moved.";
  }
}

/**
 * Calls `cb` with the current account now and on every change. `message` carries anything the user should
 * see (a merge result, or an error that came back from the OAuth redirect).
 */
export function watchAuth(cb: (auth: Auth, uid: string | null, message: string | null) => void) {
  const auth = supabase().auth;

  // OAuth errors come back on the URL. A Google account that already exists can't be linked: sign in to it instead.
  const params = new URLSearchParams(window.location.search + "&" + window.location.hash.slice(1));
  const code = params.get("error_code");
  let urlMessage: string | null = null;
  if (code) {
    window.history.replaceState(null, "", window.location.pathname);
    if (code === "identity_already_exists") {
      void saveGuest().then(() => auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirectTo() } }));
      return;
    }
    urlMessage = `Sign-in failed: ${params.get("error_description") ?? code}`;
  }

  auth.onAuthStateChange((event, s) => {
    // Supabase advises against awaiting other auth calls inside this callback; defer the follow-up work.
    setTimeout(async () => {
      if (!s) return cb({ status: "anonymous", pendingEmail: null }, null, urlMessage);
      // INITIAL_SESSION too: a code verified on the standalone /sign-in page (no store mounted there) is only
      // seen here after the redirect to "/". mergeGuest is a no-op unless a guest token was saved.
      const message = event === "SIGNED_IN" || event === "INITIAL_SESSION" ? await mergeGuest(s.user) : null;
      cb(toAuth(s.user), s.user.id, message ?? urlMessage);
      urlMessage = null;
    });
  });
}

/** Google: link it to the guest (same account, history and balance kept), or sign in if there's no guest yet. */
export async function signInWithGoogle(): Promise<void> {
  const auth = supabase().auth;
  const guest = (await auth.getSession()).data.session?.user.is_anonymous;
  const { error } = guest
    ? await auth.linkIdentity({ provider: "google", options: { redirectTo: redirectTo() } })
    : await auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirectTo() } });
  if (error) throw new Error(/manual linking/i.test(error.message) ? "Google sign-in isn't enabled yet (Supabase: allow manual identity linking)." : error.message);
}

/**
 * Magic link. A guest gets a confirmation link that turns this same account permanent ("upgrade"); if the
 * address already has an account, it gets a sign-in link to that one instead ("existing").
 */
export async function sendMagicLink(email: string): Promise<"upgrade" | "existing" | "signin"> {
  const auth = supabase().auth;
  const guest = (await auth.getSession()).data.session?.user.is_anonymous;
  if (guest) {
    const { error } = await auth.updateUser({ email }, { emailRedirectTo: redirectTo() });
    if (!error) return "upgrade";
    if (error.code !== "email_exists") throw new Error(error.message);
    await saveGuest();
  }
  const { error } = await auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo(), shouldCreateUser: !guest } });
  if (error) throw new Error(error.message);
  return guest ? "existing" : "signin";
}

/** Read-only: what kind of session this browser has. Never creates a guest (the sign-in page must not). */
export async function sessionKind(): Promise<"none" | "guest" | "user"> {
  const user = (await supabase().auth.getSession()).data.session?.user;
  return !user ? "none" : user.is_anonymous ? "guest" : "user";
}

/**
 * The 6-digit code from the same email as the link, for signing in on a different device than the one
 * that opens the email. A guest confirming their own new address uses the email-change code; everything
 * else (new or existing account) is a sign-in code.
 */
export async function verifyCode(email: string, token: string): Promise<void> {
  const auth = supabase().auth;
  const user = (await auth.getSession()).data.session?.user;
  const upgrading = user?.is_anonymous && user.new_email?.toLowerCase() === email.toLowerCase();
  const { error } = await auth.verifyOtp({ email, token, type: upgrading ? "email_change" : "email" });
  if (error) throw new Error(/expired|invalid/i.test(error.message) ? "That code is wrong or has expired. Check the latest email, or send a new one." : error.message);
}

export async function signOut() {
  const { error } = await supabase().auth.signOut();
  if (error) throw new Error(error.message);
}
