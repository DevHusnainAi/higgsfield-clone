// Client-side run store: generations persisted to localStorage, shared by sidebar and workspace.
// ponytail: one localStorage key, last 100 runs; move to a server table when accounts exist
import { useSyncExternalStore } from "react";
import { simulateGeneration, transition, type Generation } from "./generation.ts";
import type { Intent } from "./intent.ts";

const KEY = "studio.history.v1";
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
}

const EMPTY: StudioState = { runs: [], favorites: [], selectedId: null, view: "create", sessionStart: 0 };
let state: StudioState | null = null;
const listeners = new Set<() => void>();
const controllers = new Map<string, AbortController>();

function loadRuns(): Generation[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((g): g is Generation => typeof g?.id === "string" && STATUSES.has(g?.status) && typeof g?.intent?.prompt === "string")
      // Anything still in flight was running in a page that has since closed: settle it with a refund.
      .map((g) => transition(g, { type: "fail", reason: "interrupted" }));
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
    state = { runs: loadRuns(), favorites: loadFavorites(), selectedId: null, view: "create", sessionStart: Date.now() };
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

export function startGeneration(intent: Intent) {
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

export function cancelGeneration(id: string) {
  controllers.get(id)?.abort();
}
