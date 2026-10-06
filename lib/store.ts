// Client-side run store: generations persisted to localStorage, shared by sidebar and workspace.
// ponytail: one localStorage key, last 100 runs; move to a server table when accounts exist
import { useSyncExternalStore } from "react";
import { simulateGeneration, transition, type Generation } from "./generation.ts";
import type { Intent } from "./intent.ts";

const KEY = "studio.history.v1";
const MAX_RUNS = 100;
const STATUSES = new Set(["queued", "generating", "done", "failed"]);

export interface StudioState {
  runs: Generation[];
  selectedId: string | null;
}

const EMPTY: StudioState = { runs: [], selectedId: null };
let state: StudioState | null = null;
const listeners = new Set<() => void>();
const controllers = new Map<string, AbortController>();

function load(): Generation[] {
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

function getState(): StudioState {
  if (!state) {
    state = { runs: load(), selectedId: null };
    persist(); // record settled interruptions
  }
  return state;
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state!.runs));
  } catch {
    // Storage full or blocked: the session keeps working in memory.
  }
}

function set(next: Partial<StudioState>) {
  state = { ...getState(), ...next };
  if (next.runs) persist();
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    state = { ...getState(), runs: load() }; // another tab wrote
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

export function select(id: string | null) {
  set({ selectedId: id });
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
        set({ selectedId: gen.id });
      }
      upsert(gen);
      if (gen.status === "done" || gen.status === "failed") controllers.delete(gen.id);
    },
  });
}

export function cancelGeneration(id: string) {
  controllers.get(id)?.abort();
}
