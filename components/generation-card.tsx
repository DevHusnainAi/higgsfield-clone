"use client";

import { ArrowClockwise, Shuffle, X } from "@phosphor-icons/react";
import { estimateCost, statusMessage, type Generation } from "@/lib/generation";
import { cancelGeneration, select, startGeneration, useStudio } from "@/lib/store";
import { FavoriteButton } from "./favorite-button";
import { ResultMedia } from "./result-media";

export function GenerationCard({ gen, onRemix }: { gen: Generation; onRemix: (gen: Generation) => void }) {
  const { favorites, runs } = useStudio();
  const batch = gen.batchId ? runs.filter((g) => g.batchId === gen.batchId) : [];
  const running = gen.status === "queued" || gen.status === "generating";
  const [w, h] = gen.intent.aspectRatio.split(":").map(Number);

  return (
    <section aria-label="Current generation" className="flex flex-col gap-3">
      {/* Reserves the final shape so nothing jumps when the result lands. */}
      {gen.status !== "failed" && (
        <div
          style={{ aspectRatio: `${w} / ${h}`, maxWidth: `calc(50dvh * ${w} / ${h})` }}
          className="relative mx-auto w-full overflow-hidden rounded-xl border border-line bg-surface shadow-float inset-shadow-edge"
        >
          {gen.status === "done" ? (
            <ResultMedia url={gen.resultUrl} alt={gen.intent.prompt} sizes="(min-width: 768px) 672px, 100vw" controls />
          ) : (
            <div className="shimmer absolute inset-0" />
          )}
        </div>
      )}

      {batch.length > 1 && (
        <div role="group" aria-label="Outputs from this run" className="flex justify-center gap-2">
          {batch.map((g, i) => (
            <button
              key={g.id}
              type="button"
              onClick={() => select(g.id)}
              aria-label={`Output ${i + 1} of ${batch.length}`}
              aria-current={g.id === gen.id}
              className="relative size-12 overflow-hidden rounded-lg border border-line bg-surface opacity-60 transition hover:opacity-100 active:scale-[0.96] aria-[current=true]:border-accent aria-[current=true]:opacity-100"
            >
              {g.status === "done" ? (
                <ResultMedia url={g.resultUrl} alt="" sizes="48px" />
              ) : g.status === "failed" ? (
                <X size={14} className="absolute inset-0 m-auto text-danger" />
              ) : (
                <div className="shimmer absolute inset-0" />
              )}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <p role="status" className={gen.status === "failed" ? "text-sm text-danger" : "text-sm text-fg"}>
            {statusMessage(gen)}
          </p>
          <p className="text-xs text-pretty text-fg-muted">
            {running && `${gen.credits.amount} credits on hold. Charged only if it finishes.`}
            {gen.status === "done" && gen.intent.media === "video" && !/\.(mp4|webm)$/i.test(gen.resultUrl) && "Preview frame (local simulator)."}
            {gen.status === "done" && gen.demoFallback && "Stock fallback asset: the provider hit its billing limit (402), so this isn't a render of your prompt and wasn't charged."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {running && (
            <button
              type="button"
              onClick={() => cancelGeneration(gen.id)}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-line px-3 text-xs font-medium text-fg-muted transition hover:text-fg active:scale-[0.97]"
            >
              <X size={12} weight="bold" /> Cancel
            </button>
          )}
          {!running && (
            <button type="button" onClick={() => onRemix(gen)} title="Load this prompt and its settings into the composer" className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-line px-3 text-xs font-medium text-fg transition hover:border-line-strong active:scale-[0.97]">
              <Shuffle size={12} weight="bold" /> Remix
            </button>
          )}
          {gen.status === "done" && <FavoriteButton id={gen.id} active={favorites.includes(gen.id)} className="shrink-0" />}
          {gen.status === "failed" && (
            <button
              type="button"
              onClick={() => startGeneration(gen.intent)}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-line px-3 text-xs font-medium text-fg transition hover:bg-surface-raised active:scale-[0.97]"
            >
              <ArrowClockwise size={12} weight="bold" /> Retry · {estimateCost(gen.intent)} credits
            </button>
          )}
        </div>
      </div>

      {gen.status === "generating" && (
        <div
          role="progressbar"
          aria-label="Progress"
          aria-valuenow={Math.round(gen.progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-0.5 overflow-hidden rounded-full"
        >
          <div className="h-full origin-left bg-accent transition-transform duration-500" style={{ transform: `scaleX(${gen.progress})` }} />
        </div>
      )}
    </section>
  );
}
