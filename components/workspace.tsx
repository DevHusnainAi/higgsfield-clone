"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { ArrowClockwise, CloudSlash, X } from "@phosphor-icons/react";
import type { Generation } from "@/lib/generation";
import { remixOverrides, type IntentOverrides } from "@/lib/intent";
import { useDevConsoleOpen } from "@/lib/dev-log";
import { dismissNotice, refresh, select, useStudio } from "@/lib/store";
import { DevConsole } from "./dev-console";
import { GenerationCard } from "./generation-card";
import { LibraryGrid } from "./library-grid";
import { NoticeText } from "./notice-text";
import { PipelineStepper } from "./pipeline-stepper";
import { PromptComposer } from "./prompt-composer";
import { RunInspector } from "./run-inspector";
import { InspirationFeed, remixable } from "./inspiration-feed";

const focusPrompt = () => document.getElementById("prompt")?.focus();

// Landscape phones and 400% zoom: the dock + console can be taller than the screen (WCAG 1.4.10).
const SHORT = "(max-height: 640px)";
const subscribeShort = (cb: () => void) => {
  const mq = matchMedia(SHORT);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const useShortViewport = () => useSyncExternalStore(subscribeShort, () => matchMedia(SHORT).matches, () => false);

/** Media on the darkest tier, run properties beside it (below it under lg). */
function Stage({ children, inspector }: { children: ReactNode; inspector: ReactNode }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
      <div className="min-w-0 rounded-2xl border border-line-subtle bg-stage p-4 md:p-6">{children}</div>
      {inspector}
    </div>
  );
}

/** Typing a "/" into a field should type it, not jump to the prompt. */
const isEditable = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

export function Workspace() {
  const { runs, selectedId, view, notice, syncIssue, pending } = useStudio();
  const devConsole = useDevConsoleOpen();
  const [prompt, setPrompt] = useState("");
  const [overrides, setOverrides] = useState<IntentOverrides>({});
  const [announcement, setAnnouncement] = useState("");
  const selected = runs.find((g) => g.id === selectedId);
  const empty = view === "create" && !pending && !selected;
  const staged = view === "create" && !empty;
  const short = useShortViewport();
  const dock = useRef<HTMLDivElement>(null);

  // Publish the dock's real height so scroll-padding keeps focused elements clear of it (WCAG 2.4.11).
  useEffect(() => {
    const el = dock.current;
    if (!el) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty("--dock-h", `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // "/" focuses the prompt from anywhere. Esc already closes the Advanced and Start frame popovers natively.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || isEditable(e.target)) return;
      e.preventDefault();
      focusPrompt();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function changePrompt(p: string) {
    setPrompt(p);
    if (!p.trim()) setOverrides((o) => (o.reference ? { reference: o.reference } : {})); // a cleared prompt starts fresh, but keeps an uploaded frame
  }

  function pick(example: string, labels: string[]) {
    setPrompt(example);
    setOverrides({});
    focusPrompt();
    // The click has to visibly land somewhere: flash the composer border. Colour only, so it's fine under reduced motion.
    document.getElementById("prompt")?.closest("form")?.animate(
      [{ borderColor: "var(--accent)" }, { borderColor: "var(--accent)", offset: 0.4 }, {}],
      { duration: 900, easing: "ease-out" },
    );
    setAnnouncement(`Preset loaded: ${labels.join(", ")}`);
  }

  /** Back into the composer with the same settings (minus the seed), so the parser re-reads it. */
  function remix(gen: Generation) {
    setPrompt(gen.intent.prompt);
    setOverrides(remixOverrides(gen.intent));
    select(gen.id);
    focusPrompt();
  }

  return (
    // With the dev console open the preview shrinks so the card still clears the taller dock.
    <div
      style={{ "--media-h": devConsole ? "26dvh" : "50dvh" } as CSSProperties}
      className="flex min-h-[calc(100dvh-3.5rem)] flex-1 flex-col md:min-h-[100dvh]"
    >
      <div className={`mx-auto flex w-full flex-1 flex-col justify-center-safe gap-6 px-4 pb-10 pt-12 ${empty ? "max-w-6xl" : staged ? "max-w-3xl lg:max-w-6xl xl:max-w-[1400px]" : "max-w-3xl"}`}>
        {view !== "create" ? (
          <LibraryGrid filter={view} onRemix={remix} />
        ) : pending ? (
          <Stage inspector={<RunInspector intent={pending} outputs={pending.count} />}>
            <PendingCard ratio={pending.aspectRatio} />
          </Stage>
        ) : selected ? (
          <Stage
            inspector={
              <RunInspector
                intent={selected.intent}
                gen={selected}
                outputs={selected.batchId ? runs.filter((g) => g.batchId === selected.batchId).length : 1}
              />
            }
          >
            <GenerationCard key={selected.id} gen={selected} onRemix={remix} />
          </Stage>
        ) : (
          <div className="flex flex-col gap-8">
            <header className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold tracking-display text-balance md:text-3xl">What are you making?</h1>
              <p className="max-w-[60ch] text-ui text-fg-muted">
                Describe it in plain words. Format, camera and length are read from your prompt, and the cost shows before you run it.
              </p>
            </header>
            <InspirationFeed recent={remixable(runs)} onPick={pick} onRemix={remix} />
          </div>
        )}
      </div>

      <p aria-live="polite" className="sr-only">{announcement}</p>

      {/* Control layer: floats over scrolling content. */}
      {/* Short viewports: cap the dock at half the screen so content stays reachable. */}
      <div ref={dock} className="sticky bottom-0 px-4 pb-4 [@media(max-height:640px)]:max-h-[50dvh] [@media(max-height:640px)]:overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-2">
          {syncIssue && (
            <div role="status" className="glass flex items-start gap-2.5 rounded-xl border border-line px-3 py-2 text-sm text-fg">
              <CloudSlash size={16} className="mt-0.5 shrink-0 text-fg-muted" />
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{syncIssue}</span>
              <button
                type="button"
                onClick={() => void refresh()}
                className="flex shrink-0 items-center gap-1 rounded-full border border-line-strong px-2.5 py-0.5 text-xs font-medium transition hover:border-fg-muted"
              >
                <ArrowClockwise size={12} /> Retry
              </button>
            </div>
          )}
          {notice && (
            <p role="alert" className="glass flex items-start gap-2 rounded-xl border border-line px-3 py-2 text-sm text-fg">
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                <NoticeText notice={notice} onNavigate={dismissNotice} />
              </span>
              <button type="button" onClick={dismissNotice} aria-label="Dismiss" className="-my-0.5 grid size-6 shrink-0 place-items-center rounded-md text-fg-muted transition hover:bg-fg/[0.06] hover:text-fg">
                <X size={14} />
              </button>
            </p>
          )}
          <PromptComposer prompt={prompt} onPromptChange={changePrompt} overrides={overrides} onOverridesChange={setOverrides} />
        </div>
        {devConsole && !short && (
          <div className="mx-auto mt-2 w-full max-w-5xl">
            <DevConsole />
          </div>
        )}
      </div>
      {/* On short screens the console scrolls with the page instead of riding in the sticky dock. */}
      {devConsole && short && (
        <div className="mx-auto w-full max-w-5xl px-4 pb-4">
          <DevConsole />
        </div>
      )}
    </div>
  );
}

/** The start request is in flight: the intent is parsed, and the server is locking credits and creating rows. */
function PendingCard({ ratio }: { ratio: string }) {
  const [w, h] = ratio.split(":").map(Number);
  return (
    <section aria-label="Starting generation" className="flex flex-col gap-3">
      <div
        style={{ aspectRatio: `${w} / ${h}`, maxWidth: `calc(var(--media-h, 50dvh) * ${w} / ${h})` }}
        className="shimmer relative mx-auto w-full overflow-hidden rounded-lg"
      />
      <PipelineStepper active={1} />
      <p role="status" className="text-sm text-fg">
        Holding credits
      </p>
    </section>
  );
}

