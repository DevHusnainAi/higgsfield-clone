// Dev console feed. Every entry comes from something the client actually did or observed:
// a local parse, a measured request, a server-reported timing, or a state change seen in the run data.
// Nothing here is invented to look busy.
import { useSyncExternalStore } from "react";

export type DevKind = "intent" | "api" | "state" | "warn" | "error";

export interface DevEntry {
  id: number;
  at: number;
  kind: DevKind;
  text: string;
  runId?: string;
  json?: unknown;
}

const MAX_ENTRIES = 300;
const OPEN_KEY = "studio.dev-console.v1";

let entries: DevEntry[] = [];
let open: boolean | null = null; // null = not read from storage yet
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function devLog(kind: DevKind, text: string, extra: { runId?: string; json?: unknown } = {}) {
  entries = [...entries.slice(-(MAX_ENTRIES - 1)), { id: ++seq, at: Date.now(), kind, text, ...extra }];
  emit();
}

export function clearDevLog() {
  entries = [];
  emit();
}

function isOpen(): boolean {
  if (open === null) {
    try {
      open = localStorage.getItem(OPEN_KEY) === "1";
    } catch {
      open = false;
    }
  }
  return open;
}

export function setDevConsole(next: boolean) {
  open = next;
  try {
    localStorage.setItem(OPEN_KEY, next ? "1" : "0");
  } catch {
    // Storage blocked: the toggle still works for this page view.
  }
  emit();
}

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

export const useDevLog = () => useSyncExternalStore(subscribe, () => entries, () => entries);
export const useDevConsoleOpen = () => useSyncExternalStore(subscribe, isOpen, () => false);
