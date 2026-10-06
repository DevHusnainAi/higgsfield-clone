"use client";

import { useMemo } from "react";
import { ArrowUp } from "@phosphor-icons/react";
import { costBreakdown, estimateCost } from "@/lib/generation";
import { parseIntent } from "@/lib/intent";
import { startGeneration, useStudio } from "@/lib/store";
import { ParamChips } from "./param-chips";

export function PromptComposer({ prompt, onPromptChange }: { prompt: string; onPromptChange: (p: string) => void }) {
  const intent = useMemo(() => parseIntent(prompt), [prompt]);
  const cost = estimateCost(intent);
  const empty = !intent.prompt;
  const { balance } = useStudio();
  const short = balance !== null && cost > balance;

  function submit() {
    if (!empty && !short) startGeneration(intent);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="glass flex flex-col gap-2 rounded-xl border border-line p-2 shadow-float inset-shadow-edge transition-colors focus-within:border-line-strong"
    >
      <label htmlFor="prompt" className="sr-only">
        Describe what you want to make
      </label>
      <textarea
        id="prompt"
        name="prompt"
        rows={2}
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="A slow dolly-in on a rain-soaked neon street, 35mm, night"
        className="block max-h-56 min-h-14 w-full resize-none bg-transparent px-3 py-2.5 text-base leading-relaxed text-fg outline-none [field-sizing:content] placeholder:text-fg-muted"
      />
      <ParamChips intent={intent} />
      <div className="flex items-center justify-between gap-3 pl-3 pr-1">
        <span className="truncate font-mono text-xs text-fg-muted" aria-live="polite">
          {empty ? "Shift + Enter for a new line" : `${costBreakdown(intent)} = ${cost}`}
        </span>
        <button
          type="submit"
          disabled={empty || short}
          className="flex h-9 shrink-0 items-center gap-2 rounded-full bg-accent pl-4 pr-3 text-sm font-medium text-accent-ink transition hover:brightness-105 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          {empty ? "Generate" : short ? `Need ${cost}, have ${balance}` : `Generate · ${cost} credits`}
          <ArrowUp size={16} weight="bold" />
        </button>
      </div>
    </form>
  );
}
