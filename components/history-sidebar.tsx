"use client";

import { ClockCounterClockwise, Plus } from "@phosphor-icons/react";
import type { Generation } from "@/lib/generation";
import { select, useStudio } from "@/lib/store";

function meta(gen: Generation): string {
  switch (gen.status) {
    case "queued":
      return "Queued";
    case "generating":
      return `Generating ${Math.round(gen.progress * 100)}%`;
    case "done":
      return `${gen.credits.amount} credits`;
    case "failed":
      return `Failed, ${gen.credits.amount} refunded`;
  }
}

// ponytail: desktop only; mobile drawer when the history needs to be reachable on phones
export function HistorySidebar() {
  const { runs, selectedId } = useStudio();

  return (
    <aside className="sticky top-0 hidden h-[100dvh] w-72 shrink-0 flex-col border-r border-line bg-surface md:flex">
      <div className="flex h-16 shrink-0 items-center justify-between px-5">
        <span className="text-[15px] font-semibold tracking-tight">Studio</span>
        <button
          onClick={() => select(null)}
          aria-label="New generation"
          className="grid size-8 place-items-center rounded-full text-fg-muted transition hover:bg-surface-raised hover:text-fg active:scale-[0.96]"
        >
          <Plus size={16} weight="bold" />
        </button>
      </div>

      <nav aria-label="History" className="flex min-h-0 flex-1 flex-col px-3 pb-4">
        <h2 className="px-2 pb-2 text-xs font-medium text-fg-muted">History</h2>
        {runs.length === 0 ? (
          <div className="mx-2 mt-2 flex flex-col items-start gap-3 rounded-xl border border-dashed border-line p-4">
            <ClockCounterClockwise size={20} className="text-fg-muted" />
            <p className="text-sm leading-relaxed text-fg-muted">
              Everything you generate shows up here, with its prompt, settings and credit cost.
            </p>
          </div>
        ) : (
          <ul className="-mx-1 flex flex-col gap-0.5 overflow-y-auto px-1">
            {runs.map((gen) => (
              <li key={gen.id}>
                <button
                  onClick={() => select(gen.id)}
                  aria-current={gen.id === selectedId ? "true" : undefined}
                  className="flex w-full flex-col gap-0.5 rounded-xl px-3 py-2 text-left transition hover:bg-surface-raised aria-[current]:bg-surface-raised"
                >
                  <span className="line-clamp-2 text-sm leading-snug text-fg">{gen.intent.prompt}</span>
                  <span className={gen.status === "failed" ? "text-xs text-danger" : "text-xs text-fg-muted"}>
                    {meta(gen)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>
    </aside>
  );
}
