"use client";

import { useMemo, useState } from "react";
import { ArrowUp } from "@phosphor-icons/react";
import { costBreakdown, estimateCost } from "@/lib/generation";
import { parseIntent } from "@/lib/intent";
import { startGeneration } from "@/lib/store";
import { ParamChips } from "./param-chips";

export function PromptComposer() {
  const [prompt, setPrompt] = useState("");
  const intent = useMemo(() => parseIntent(prompt), [prompt]);
  const cost = estimateCost(intent);
  const empty = !intent.prompt;

  function submit() {
    if (!empty) startGeneration(intent);
  }

  return (
    <div className="flex w-full flex-col gap-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="rounded-xl border border-line bg-surface-raised p-2 shadow-[0_8px_30px_-12px_oklch(0.2_0.01_260/0.25)] focus-within:border-fg-muted"
      >
        <label htmlFor="prompt" className="sr-only">
          Describe what you want to make
        </label>
        <textarea
          id="prompt"
          name="prompt"
          rows={2}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="A slow dolly-in on a rain-soaked neon street, 35mm, night"
          className="block max-h-64 min-h-14 w-full resize-none bg-transparent px-3 py-2.5 text-base leading-relaxed text-fg outline-none [field-sizing:content] placeholder:text-fg-muted"
        />
        <div className="flex items-center justify-between gap-3 pl-3 pr-1 pt-1">
          <span className="truncate font-mono text-xs text-fg-muted" aria-live="polite">
            {empty ? "Shift + Enter for a new line" : `${costBreakdown(intent)} = ${cost}`}
          </span>
          <button
            type="submit"
            disabled={empty}
            className="flex h-9 shrink-0 items-center gap-2 rounded-full bg-accent pl-4 pr-3 text-sm font-medium text-accent-ink transition hover:brightness-105 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            {empty ? "Generate" : `Generate · ${cost} credits`}
            <ArrowUp size={16} weight="bold" />
          </button>
        </div>
      </form>
      <ParamChips intent={intent} />
    </div>
  );
}
