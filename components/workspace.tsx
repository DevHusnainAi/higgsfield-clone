"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { ArrowClockwise, CloudSlash, X } from "@phosphor-icons/react";
import type { Generation } from "@/lib/generation";
import { remixOverrides, type IntentOverrides } from "@/lib/intent";
import { useDevConsoleOpen } from "@/lib/dev-log";
import { dismissNotice, refresh, select, useStudio } from "@/lib/store";
import { DevConsole } from "./dev-console";
import { GenerationCard } from "./generation-card";
import { LibraryGrid } from "./library-grid";
import { PipelineStepper } from "./pipeline-stepper";
import { PromptComposer } from "./prompt-composer";
import { InspirationFeed, remixable } from "./inspiration-feed";

const focusPrompt = () => document.getElementById("prompt")?.focus();

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
      <div className={`mx-auto flex w-full flex-1 flex-col justify-center-safe gap-6 px-4 pb-10 pt-12 ${empty ? "max-w-6xl" : "max-w-3xl"}`}>
        {view !== "create" ? (
          <LibraryGrid filter={view} onRemix={remix} />
        ) : pending ? (
          <PendingCard ratio={pending.aspectRatio} />
        ) : selected ? (
          <GenerationCard key={selected.id} gen={selected} onRemix={remix} />
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
      <div className="sticky bottom-0 px-4 pb-4">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-2">
          {syncIssue && (
            <div role="status" className="glass flex items-start gap-2.5 rounded-xl border border-line px-3 py-2 text-sm text-fg">
              <CloudSlash size={16} className="mt-0.5 shrink-0 text-fg-muted" />
              <span className="flex-1">{syncIssue}</span>
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
              <span className="flex-1">{notice}</span>
              <button type="button" onClick={dismissNotice} aria-label="Dismiss" className="text-fg-muted hover:text-fg">
                <X size={14} />
              </button>
            </p>
          )}
          <PromptComposer prompt={prompt} onPromptChange={changePrompt} overrides={overrides} onOverridesChange={setOverrides} />
        </div>
        {devConsole && (
          <div className="mx-auto mt-2 w-full max-w-5xl">
            <DevConsole />
          </div>
        )}
      </div>
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
        className="shimmer relative mx-auto w-full overflow-hidden rounded-xl border border-line shadow-float inset-shadow-edge"
      />
      <PipelineStepper active={1} />
      <p role="status" className="text-sm text-fg">
        Holding credits
      </p>
    </section>
  );
}

