// Client-side run store shared by sidebar and workspace.
// Remote mode (Supabase env set): the API is the source of truth; localStorage is an offline cache.
// Local mode: renders are simulated in the browser and localStorage is the only store.
import { useSyncExternalStore } from "react";
import { estimateCost, simulateGeneration, transition, type Generation } from "./generation.ts";
import type { Intent } from "./intent.ts";
import { api, remoteEnabled } from "./remote.ts";

const KEY = remoteEnabled ? "studio.remote-cache.v1" : "studio.history.v1";
const POLL_MS = 2000;
const OFFLINE = "Offline. Showing your saved history; it will update when the connection is back.";
const FAVORITES_KEY = "studio.favorites.v1";
const MAX_RUNS = 100;
const STATUSES = new Set(["queued", "generating", "done", "failed"]);

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
  /** One-line message for the user (offline, out of credits). */
  notice: string | null;
}

const EMPTY: StudioState = { runs: [], favorites: [], selectedId: null, view: "create", sessionStart: 0, balance: null, notice: null };
let state: StudioState | null = null;
const listeners = new Set<() => void>();
const controllers = new Map<string, AbortController>();
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let synced = false;

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

function set(next: Partial<StudioState>) {
  state = { ...getState(), ...next };
  if (next.runs) persist(KEY, state.runs);
  if (next.favorites) persist(FAVORITES_KEY, state.favorites);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (remoteEnabled && !synced) {
    synced = true;
    void refresh();
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

/** Pull runs + balance from the server; keeps polling while anything is still rendering. */
async function refresh() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  try {
    const res = await api<{ runs: Generation[]; balance: number; error?: string }>("/api/generations");
    if (!res.ok) throw new Error(res.data.error);
    const { notice } = getState();
    set({ runs: res.data.runs, balance: res.data.balance, notice: notice === OFFLINE ? null : notice });
  } catch {
    set({ notice: OFFLINE });
  }
  const { runs, notice } = getState();
  if (runs.some(isActive) || notice === OFFLINE) pollTimer = setTimeout(refresh, POLL_MS);
}

export function dismissNotice() {
  set({ notice: null });
}

export function startGeneration(intent: Intent) {
  if (remoteEnabled) return void startRemote(intent);
  const ctrl = new AbortController();
  let first = true;
  void simulateGeneration(intent, {
    signal: ctrl.signal,
    onUpdate: (gen) => {
      if (first) {
        first = false;
        controllers.set(gen.id, ctrl);
        set({ selectedId: gen.id, view: "create" });
      }
      upsert(gen);
      if (gen.status === "done" || gen.status === "failed") controllers.delete(gen.id);
    },
  });
}

async function startRemote(intent: Intent) {
  try {
    // The server re-parses the prompt and prices it; it never trusts a client-side cost.
    const res = await api<{ generation?: Generation; balance?: number; cost?: number; error?: string }>("/api/generations", {
      method: "POST",
      body: JSON.stringify({ prompt: intent.prompt }),
    });
    if (res.status === 402) {
      set({ balance: res.data.balance ?? null, notice: `Not enough credits: this needs ${res.data.cost ?? estimateCost(intent)}, you have ${res.data.balance}. Nothing was charged.` });
      return;
    }
    if (!res.ok || !res.data.generation) throw new Error(res.data.error);
    upsert(res.data.generation);
    set({ selectedId: res.data.generation.id, view: "create", balance: res.data.balance ?? null, notice: null });
    void refresh();
  } catch {
    set({ notice: "Couldn't start the generation: the server didn't respond. Check your library before retrying." });
  }
}

export function cancelGeneration(id: string) {
  if (!remoteEnabled) return void controllers.get(id)?.abort();
  void api<{ generation?: Generation; balance?: number }>(`/api/generations/${id}/cancel`, { method: "POST" })
    .then((res) => {
      if (res.data.generation) upsert(res.data.generation);
      if (typeof res.data.balance === "number") set({ balance: res.data.balance });
    })
    .catch(() => set({ notice: "Couldn't reach the server to cancel. It will settle and refund automatically if it fails." }));
}
