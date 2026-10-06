import { Check } from "@phosphor-icons/react";
import type { Generation } from "@/lib/generation";

const STEPS = ["Parsing intent", "Locking credits", "Awaiting GPU", "Finalizing"] as const;

/**
 * Index of the step a run is on, from real state only. The server marks progress 0.9 once the provider has
 * returned and it is uploading + settling, so that is "Finalizing". A row exists only after the credit lock
 * succeeded, so rows start at "Awaiting GPU"; the first two steps show while the start request is in flight.
 */
export function stepOf(gen: Generation): number {
  if (gen.status === "done") return STEPS.length;
  if (gen.status === "generating" && gen.progress >= 0.9) return 3;
  return 2;
}

export function PipelineStepper({ active }: { active: number }) {
  return (
    <ol aria-label="Pipeline" className="grid grid-cols-4 gap-2">
      {STEPS.map((label, i) => {
        const done = i < active;
        const current = i === active;
        return (
          <li key={label} aria-current={current ? "step" : undefined} className="flex min-w-0 flex-col gap-2">
            <div className={`relative h-1 overflow-hidden rounded-full ${done ? "bg-accent" : current ? "bg-accent/20" : "bg-line"}`}>
              {current && <div className="step-sweep absolute inset-y-0 left-0 rounded-full bg-accent" />}
            </div>
            <span className={`flex items-center gap-1.5 text-xs ${done || current ? "text-fg" : "text-fg-muted"}`}>
              {done ? (
                <Check size={12} weight="bold" className="shrink-0 text-accent-text" />
              ) : (
                <span className={`size-1.5 shrink-0 rounded-full ${current ? "bg-accent motion-safe:animate-pulse" : "bg-line-strong"}`} />
              )}
              <span className="truncate">{label}</span>
              {done && <span className="sr-only">, done</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
