"use client";

import { useEffect, useRef, useState } from "react";
import { CaretDown, Terminal, Trash, X } from "@phosphor-icons/react";
import { clearDevLog, setDevConsole, useDevLog, type DevKind } from "@/lib/dev-log";
import { useStudio } from "@/lib/store";

const KIND: Record<DevKind, string> = {
  intent: "text-fg",
  api: "text-fg-muted",
  state: "text-accent-text",
  warn: "text-accent-text",
  error: "text-danger",
};

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour12: false }) + "." + String(at % 1000).padStart(3, "0");

/** Read-only engineering view: the event stream plus the selected run's raw state. */
export function DevConsole() {
  const entries = useDevLog();
  const { runs, selectedId, pending } = useStudio();
  const selected = pending ?? runs.find((g) => g.id === selectedId) ?? null;
  const [collapsed, setCollapsed] = useState(false);
  const stream = useRef<HTMLOListElement>(null);
  const pinned = useRef(true); // follow new lines unless the reader scrolled up

  useEffect(() => {
    const el = stream.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [entries, collapsed]);

  return (
    <section aria-label="Dev console" className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface font-mono text-xs shadow-float inset-shadow-edge">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3 text-fg-muted">
        <Terminal size={14} />
        <span className="font-sans font-medium text-fg">Dev console</span>
        <span className="tabular-nums">{entries.length} events</span>
        <span className="flex-1" />
        <button type="button" onClick={clearDevLog} aria-label="Clear events" className="grid size-7 place-items-center rounded-md transition hover:bg-fg/[0.06] hover:text-fg">
          <Trash size={13} />
        </button>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand dev console" : "Collapse dev console"}
          className="grid size-7 place-items-center rounded-md transition hover:bg-fg/[0.06] hover:text-fg"
        >
          <CaretDown size={13} className={`transition-transform ${collapsed ? "rotate-180" : ""}`} />
        </button>
        <button type="button" onClick={() => setDevConsole(false)} aria-label="Close dev console" className="grid size-7 place-items-center rounded-md transition hover:bg-fg/[0.06] hover:text-fg">
          <X size={13} />
        </button>
      </header>

      {!collapsed && (
        <div className="grid h-56 min-h-0 md:grid-cols-[1fr_minmax(0,18rem)]">
          <ol
            ref={stream}
            role="log"
            aria-live="off"
            onScroll={(e) => {
              const el = e.currentTarget;
              pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
            }}
            className="min-h-0 overflow-y-auto px-3 py-2 leading-relaxed"
          >
            {entries.length === 0 && <li className="text-fg-muted">Waiting for activity. Generate something to see the pipeline.</li>}
            {entries.map((e) => (
              <li key={e.id} className={e.runId && e.runId === selectedId ? "bg-accent/[0.06]" : undefined}>
                <span className="text-fg-muted">{time(e.at)} </span>
                <span className={`${KIND[e.kind]} uppercase`}>{e.kind.padEnd(6)} </span>
                {e.runId && <span className="text-fg-muted">{e.runId.slice(0, 8)} </span>}
                <span className="text-fg">{e.text}</span>
                {e.json !== undefined && (
                  <details className="pl-4">
                    <summary className="cursor-pointer text-fg-muted hover:text-fg">json</summary>
                    <pre className="overflow-x-auto whitespace-pre text-fg-muted">{JSON.stringify(e.json, null, 2)}</pre>
                  </details>
                )}
              </li>
            ))}
          </ol>
          <div className="hidden min-h-0 flex-col border-l border-line md:flex">
            <p className="border-b border-line px-3 py-1.5 text-fg-muted">{pending ? "Pending start: intent" : "Selected run: state"}</p>
            <pre className="min-h-0 flex-1 overflow-auto px-3 py-2 text-fg-muted">{selected ? JSON.stringify(selected, null, 2) : "No run selected."}</pre>
          </div>
        </div>
      )}
    </section>
  );
}
