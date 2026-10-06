// Client-side run store shared by sidebar and workspace.
// Remote mode (Supabase env set): the API is the source of truth; localStorage is an offline cache.
// Local mode: renders are simulated in the browser and localStorage is the only store.
import { useSyncExternalStore } from "react";
import { estimateCost, simulateGeneration, splitBatch, transition, type Generation } from "./generation.ts";
import { OVERRIDE_KEYS, type Intent } from "./intent.ts";
import { devLog } from "./dev-log.ts";
import { api, remoteEnabled, SyncError, watchAuth, type Auth } from "./remote.ts";

const KEY = remoteEnabled ? "studio.remote-cache.v1" : "studio.history.v1";
const POLL_MS = 2000;
const MAX_BACKOFF_MS = 60_000;
const FAVORITES_KEY = "studio.favorites.v1";
/** Which account the cached history belongs to, so another account (or a signed-out browser) never sees it. */
const OWNER_KEY = "studio.remote-cache.owner";
const MAX_RUNS = 100;
const STATUSES = new Set(["queued", "generating", "done", "failed"]);
const FALLBACK_NOTICE = "Upstream API limit reached (402). Displaying fallback asset to preserve application state.";

export type LibraryFilter = "all" | "images" | "videos" | "favorites";
export type View = "create" | LibraryFilter;

export interface StudioState {
  runs: Generation[];
  favorites: string[];
  selectedId: string | null;
  view: View;
  /** Runs created at or after this belong to "this session". */
  sessionStart: number;
  /** Account balance from the server; null in local mode. */
  balance: number | null;
  /** One-line message about the user's last action (e.g. out of credits). */
  notice: string | null;
  /** Why syncing with the server is failing, if it is. History stays readable from the cache. */
  syncIssue: string | null;
  /** A start request in flight: parsed, waiting on the server to lock credits and create the rows. */
  pending: Intent | null;
  /** Remote mode only. "unknown" until the browser has read its session (and always on the server). */
  auth: Auth;
}

const EMPTY: StudioState = {
  runs: [], favorites: [], selectedId: null, view: "create", sessionStart: 0, balance: null, notice: null, syncIssue: null, pending: null,
  auth: { status: "unknown" },
};
let state: StudioState | null = null;
const listeners = new Set<() => void>();
const controllers = new Map<string, AbortController>();
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let synced = false;
let inflight: Promise<void> | null = null;
let failures = 0;
/** The account the store currently belongs to; replies sent as any other account are dropped. */
let currentUid: string | null = null;

const isActive = (g: Generation) => g.status === "queued" || g.status === "generating";

function loadRuns(): Generation[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((g): g is Generation => typeof g?.id === "string" && STATUSES.has(g?.status) && typeof g?.intent?.prompt === "string")
      // Local mode: anything still in flight ran in a page that has since closed, so settle it with a refund.
      // Remote mode: the server owns these runs and may still be rendering them.
      .map((g) => (remoteEnabled ? g : transition(g, { type: "fail", reason: "interrupted" })));
  } catch {
    return [];
  }
}

function loadFavorites(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function getState(): StudioState {
  if (!state) {
    state = { ...EMPTY, runs: loadRuns(), favorites: loadFavorites(), sessionStart: Date.now() };
    persist(KEY, state.runs); // record settled interruptions
  }
  return state;
}

function persist(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the session keeps working in memory.
  }
}

const SIM = remoteEnabled ? "" : "[simulated] ";

/** What a run's state means, in pipeline terms. Progress 0.9 is the server's "provider returned, uploading" mark. */
function describe(g: Generation): string {
  switch (g.status) {
    case "queued":
      return `queued: ${g.credits.amount} credits held, awaiting GPU`;
    case "generating":
      return g.progress >= 0.9 ? "provider returned; uploading result and settling" : "provider call in flight";
    case "done":
      return g.demoFallback
        ? `demo fallback triggered (provider 402): stock asset saved, ${g.credits.amount} credits refunded`
        : `done: ${g.credits.amount} credits charged`;
    case "failed":
      return `failed (${g.reason}): ${g.credits.amount} credits refunded`;
  }
}

/** Logs each run whose meaning changed (new active runs included), not every poll. */
function logChanges(prev: Generation[], next: Generation[]) {
  const before = new Map(prev.map((g) => [g.id, g]));
  for (const g of next) {
    const old = before.get(g.id);
    if (old ? describe(old) === describe(g) : !isActive(g)) continue;
    const kind = g.status === "failed" || (g.status === "done" && g.demoFallback) ? "warn" : "state";
    devLog(kind, SIM + describe(g), { runId: g.id, json: g.status === "done" || g.status === "failed" ? g.credits : undefined });
  }
}

function set(next: Partial<StudioState>) {
  if (next.runs) logChanges(getState().runs, next.runs);
  state = { ...getState(), ...next };
  if (next.runs) persist(KEY, state.runs);
  if (next.favorites) persist(FAVORITES_KEY, state.favorites);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (remoteEnabled && !synced) {
    synced = true;
    watchAuth(onAuth);
    void refresh();
    // Come back as soon as there's a reason to: network restored or the tab is looked at again.
    window.addEventListener("online", () => void refresh());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && getState().syncIssue) void refresh();
    });
  }
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) state = { ...getState(), runs: loadRuns() }; // another tab wrote
    else if (e.key === FAVORITES_KEY) state = { ...getState(), favorites: loadFavorites() };
    else return;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function readOwner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

/**
 * Whether cached history must be dropped: the session belongs to a different account than the cache
 * (`owner`), or the user signed out. An anonymous user upgrading in place keeps the same uid, so keeps it all.
 */
export const accountSwitched = (owner: string | null, uid: string | null, previous: string | null) =>
  (uid !== null && owner !== null && owner !== uid) || (uid === null && previous !== null);

/** Account changes: sign-in to another account or sign-out clears the old account's history before anything renders. */
function onAuth(auth: Auth, uid: string | null, message: string | null) {
  const switched = accountSwitched(readOwner(), uid, currentUid);
  currentUid = uid;
  try {
    if (uid) localStorage.setItem(OWNER_KEY, uid);
    else localStorage.removeItem(OWNER_KEY);
  } catch {}
  set({
    auth,
    ...(switched && { runs: [], balance: null, selectedId: null, pending: null, syncIssue: null }),
    ...(message && { notice: message }),
  });
  void refresh(); // new balance after an upgrade's grant, or the new account's history
}

export function useStudio(): StudioState {
  return useSyncExternalStore(subscribe, getState, () => EMPTY);
}

function upsert(gen: Generation) {
  const runs = getState().runs;
  const i = runs.findIndex((g) => g.id === gen.id);
  set({ runs: i === -1 ? [gen, ...runs].slice(0, MAX_RUNS) : runs.with(i, gen) });
}

/** Open a run in the create view (null = blank composer). */
export function select(id: string | null) {
  set({ selectedId: id, view: "create" });
}

export function setView(view: View) {
  set({ view });
}

export function toggleFavorite(id: string) {
  const { favorites } = getState();
  set({ favorites: favorites.includes(id) ? favorites.filter((f) => f !== id) : [id, ...favorites] });
}

export function matchesFilter(gen: Generation, filter: LibraryFilter, favorites: string[]): boolean {
  if (filter === "images") return gen.intent.media === "image";
  if (filter === "videos") return gen.intent.media === "video";
  if (filter === "favorites") return favorites.includes(gen.id);
  return true;
}

function logSyncError(where: string, err: unknown) {
  devLog("error", `${where} failed${err instanceof SyncError ? ` (${err.kind}): ${err.message}` : ""}`, { json: err instanceof SyncError ? err.detail : String(err) });
  if (err instanceof SyncError) console.error(`[studio:sync] ${where} failed (${err.kind}): ${err.message}`, err.detail ?? "");
  else console.error(`[studio:sync] ${where} failed (unexpected)`, err);
}

function schedule(ms: number) {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(() => void refresh(), ms);
}

/**
 * Pull runs + balance from the server. Polls every 2s while something is rendering.
 * On failure: retryable errors back off (2s, 4s, 8s... up to 60s); config/auth errors stop until a manual retry,
 * the network returns, or the tab regains focus. The cached history stays on screen throughout.
 */
export function refresh(): Promise<void> {
  inflight ??= (async () => {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    try {
      const t0 = performance.now();
      const res = await api<{ runs: Generation[]; balance: number; swept?: number; error?: string }>("/api/generations");
      if (currentUid && res.uid !== currentUid) return schedule(0); // sent before a sign-in/out: drop it, fetch again as the new account
      devLog("api", `GET /api/generations → ${res.status} in ${Math.round(performance.now() - t0)}ms`);
      if (res.data.swept) devLog("warn", `stale sweep: ${res.data.swept} stuck run(s) failed as timeout and refunded`);
      if (!res.ok) throw new SyncError("server", `Unexpected response (${res.status}): ${res.data.error ?? "no details"}.`, res.data);
      if (failures > 0) console.info(`[studio:sync] recovered after ${failures} failed attempt(s)`);
      failures = 0;
      // Toast once per run that just finished on the demo fallback (not for old ones already in history).
      const wasActive = new Set(getState().runs.filter(isActive).map((g) => g.id));
      const fellBack = res.data.runs.some((g) => g.status === "done" && g.demoFallback && wasActive.has(g.id));
      set({ runs: res.data.runs, balance: res.data.balance, syncIssue: null, ...(fellBack && { notice: FALLBACK_NOTICE }) });
      if (res.data.runs.some(isActive)) schedule(POLL_MS);
    } catch (err) {
      failures++;
      logSyncError("refresh", err);
      const retry = !(err instanceof SyncError) || err.retry;
      const delay = Math.min(MAX_BACKOFF_MS, POLL_MS * 2 ** failures);
      const reason = err instanceof SyncError ? err.message : "Sync failed unexpectedly.";
      set({ syncIssue: retry ? `${reason} Retrying in ${Math.round(delay / 1000)}s.` : reason });
      if (retry) schedule(delay);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function dismissNotice() {
  set({ notice: null });
}

export function startGeneration(intent: Intent) {
  devLog(
    "intent",
    `${SIM}parsed intent: ${intent.media}, ${intent.model}, ${intent.count} output${intent.count > 1 ? "s" : ""}, ${estimateCost(intent)} credits${remoteEnabled ? " (server re-parses and re-prices)" : ""}`,
    { json: intent },
  );
  if (remoteEnabled) return void startRemote(intent);
  const batchId = crypto.randomUUID();
  // Reversed so output 1 is upserted last and lands on top, matching the server's order.
  splitBatch(intent).reverse().forEach((item, i, all) => {
    const ctrl = new AbortController();
    let first = true;
    void simulateGeneration(item, {
      signal: ctrl.signal,
      batchId: all.length > 1 ? batchId : undefined,
      onUpdate: (gen) => {
        if (first) {
          first = false;
          controllers.set(gen.id, ctrl);
          if (i === all.length - 1) set({ selectedId: gen.id, view: "create" });
        }
        upsert(gen);
        if (gen.status === "done" || gen.status === "failed") controllers.delete(gen.id);
      },
    });
  });
}

async function startRemote(intent: Intent) {
  set({ pending: intent });
  try {
    // The server re-parses the prompt, re-validates these settings and prices it; it never trusts a client-side cost.
    const overrides = Object.fromEntries(OVERRIDE_KEYS.map((k) => [k, intent[k]]));
    const t0 = performance.now();
    const res = await api<{ generations?: Generation[]; balance?: number; cost?: number; timing?: { startGenerationMs: number }; error?: string }>("/api/generations", {
      method: "POST",
      body: JSON.stringify({ prompt: intent.prompt, overrides }),
    });
    devLog(res.ok ? "api" : "warn", `POST /api/generations → ${res.status} in ${Math.round(performance.now() - t0)}ms`, { json: res.ok ? undefined : res.data });
    if (res.data.timing && res.data.generations) {
      const n = res.data.generations.length;
      devLog(
        "api",
        `start_generation: balance row locked (FOR UPDATE), cap + balance checked, ${n} row${n > 1 ? "s" : ""} created in ${res.data.timing.startGenerationMs}ms; balance now ${res.data.balance}`,
        { runId: res.data.generations[0].id },
      );
    }
    if (currentUid && res.uid !== currentUid) return; // the account changed while this was in flight
    if (res.status === 402) {
      set({ balance: res.data.balance ?? null, notice: `Not enough credits: this needs ${res.data.cost ?? estimateCost(intent)}, you have ${res.data.balance}. Nothing was charged.` });
      return;
    }
    if (res.status === 429) return set({ notice: `${res.data.error ?? "Too many requests."} Nothing was charged.` });
    const started = res.data.generations;
    if (!res.ok || !started?.length) throw new SyncError("server", `Couldn't start the generation: ${res.data.error ?? res.status}.`, res.data);
    started.toReversed().forEach(upsert);
    set({ selectedId: started[0].id, view: "create", balance: res.data.balance ?? null, notice: null });
    void refresh();
  } catch (err) {
    logSyncError("start", err);
    // A dropped response may still have started (and held credits for) the run; the next refresh will show it.
    set({ notice: `${err instanceof SyncError ? err.message : "Couldn't start the generation."} Check your library before retrying.` });
    void refresh();
  } finally {
    set({ pending: null });
  }
}

export function cancelGeneration(id: string) {
  if (!remoteEnabled) return void controllers.get(id)?.abort();
  const t0 = performance.now();
  void api<{ generation?: Generation; balance?: number }>(`/api/generations/${id}/cancel`, { method: "POST" })
    .then((res) => {
      devLog(res.ok ? "api" : "warn", `POST /api/generations/${id.slice(0, 8)}…/cancel → ${res.status} in ${Math.round(performance.now() - t0)}ms`, { runId: id });
      if (res.status === 429) set({ notice: "Too many requests. Try cancelling again in a few minutes." });
      if (res.data.generation) upsert(res.data.generation);
      if (typeof res.data.balance === "number") set({ balance: res.data.balance });
    })
    .catch((err) => {
      logSyncError("cancel", err);
      set({ notice: "Couldn't reach the server to cancel. If the render fails or stalls it is refunded automatically." });
    });
}
