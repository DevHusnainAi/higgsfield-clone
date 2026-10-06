"use client";

import { useState } from "react";
import { ArrowClockwise, CloudSlash, X } from "@phosphor-icons/react";
import type { Generation } from "@/lib/generation";
import { remixOverrides, type IntentOverrides } from "@/lib/intent";
import { dismissNotice, refresh, select, useStudio } from "@/lib/store";
import { GenerationCard } from "./generation-card";
import { LibraryGrid } from "./library-grid";
import { PromptComposer } from "./prompt-composer";
import { StarterCards } from "./starter-cards";

const focusPrompt = () => document.getElementById("prompt")?.focus();

export function Workspace() {
  const { runs, selectedId, view, notice, syncIssue } = useStudio();
  const [prompt, setPrompt] = useState("");
  const [overrides, setOverrides] = useState<IntentOverrides>({});
  const selected = runs.find((g) => g.id === selectedId);

  function changePrompt(p: string) {
    setPrompt(p);
    if (!p.trim()) setOverrides((o) => (o.reference ? { reference: o.reference } : {})); // a cleared prompt starts fresh, but keeps an uploaded frame
  }

  function pick(example: string) {
    setPrompt(example);
    setOverrides({});
    focusPrompt();
  }

  /** Back into the composer with the same settings (minus the seed), so the parser re-reads it. */
  function remix(gen: Generation) {
    setPrompt(gen.intent.prompt);
    setOverrides(remixOverrides(gen.intent));
    select(gen.id);
    focusPrompt();
  }

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] flex-1 flex-col md:min-h-[100dvh]">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center-safe gap-6 px-4 pb-10 pt-12">
        {view !== "create" ? (
          <LibraryGrid filter={view} onRemix={remix} />
        ) : selected ? (
          <GenerationCard key={selected.id} gen={selected} onRemix={remix} />
        ) : (
          <div className="flex flex-col items-center gap-6 text-center">
            <h1 className="text-3xl font-semibold tracking-tight text-balance md:text-4xl">What are you making?</h1>
            <p className="max-w-[48ch] text-sm leading-relaxed text-fg-muted">
              Describe it in plain words. Format, camera and length are read from your prompt, and the cost shows before you run it.
            </p>
            <StarterCards onPick={pick} />
          </div>
        )}
      </div>

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
      </div>
    </div>
  );
}
