"use client";

import { useState } from "react";
import { useStudio } from "@/lib/store";
import { GenerationCard } from "./generation-card";
import { LibraryGrid } from "./library-grid";
import { PromptComposer } from "./prompt-composer";
import { StarterCards } from "./starter-cards";

export function Workspace() {
  const { runs, selectedId, view } = useStudio();
  const [prompt, setPrompt] = useState("");
  const selected = runs.find((g) => g.id === selectedId);

  function pick(example: string) {
    setPrompt(example);
    document.getElementById("prompt")?.focus();
  }

  return (
    <div className="flex min-h-[100dvh] flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center-safe gap-6 px-4 pb-10 pt-12">
        {view !== "create" ? (
          <LibraryGrid filter={view} />
        ) : selected ? (
          <GenerationCard key={selected.id} gen={selected} />
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
        <div className="mx-auto w-full max-w-2xl">
          <PromptComposer prompt={prompt} onPromptChange={setPrompt} />
        </div>
      </div>
    </div>
  );
}
