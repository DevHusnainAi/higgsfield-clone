"use client";

import { useStudio } from "@/lib/store";
import { GenerationCard } from "./generation-card";
import { PromptComposer } from "./prompt-composer";

export function Workspace() {
  const { runs, selectedId } = useStudio();
  const selected = runs.find((g) => g.id === selectedId);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-4 py-16">
      {selected ? (
        <GenerationCard key={selected.id} gen={selected} />
      ) : (
        <h1 className="text-3xl font-semibold tracking-tight text-balance md:text-4xl">What are you making?</h1>
      )}
      <PromptComposer />
    </div>
  );
}
