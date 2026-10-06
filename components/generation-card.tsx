"use client";

import Image from "next/image";
import { ArrowClockwise, X } from "@phosphor-icons/react";
import { statusMessage, type Generation } from "@/lib/generation";
import { cancelGeneration, startGeneration, useStudio } from "@/lib/store";
import { FavoriteButton } from "./favorite-button";

export function GenerationCard({ gen }: { gen: Generation }) {
  const { favorites } = useStudio();
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
            <Image src={gen.resultUrl} alt={gen.intent.prompt} fill sizes="(min-width: 768px) 672px, 100vw" className="object-cover" />
          ) : (
            <div className="shimmer absolute inset-0" />
          )}
        </div>
      )}

      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <p role="status" className={gen.status === "failed" ? "text-sm text-danger" : "text-sm text-fg"}>
            {statusMessage(gen)}
          </p>
          <p className="truncate text-xs text-fg-muted">
            {running && `${gen.credits.amount} credits on hold. Charged only if it finishes.`}
            {gen.status === "done" && gen.intent.media === "video" && "Preview frame (mock renderer)."}
          </p>
        </div>
        {running && (
          <button
            onClick={() => cancelGeneration(gen.id)}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-line px-3 text-xs font-medium text-fg-muted transition hover:text-fg active:scale-[0.97]"
          >
            <X size={12} weight="bold" /> Cancel
          </button>
        )}
        {gen.status === "done" && <FavoriteButton id={gen.id} active={favorites.includes(gen.id)} className="shrink-0" />}
        {gen.status === "failed" && (
          <button
            onClick={() => startGeneration(gen.intent)}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-line px-3 text-xs font-medium text-fg transition hover:bg-surface-raised active:scale-[0.97]"
          >
            <ArrowClockwise size={12} weight="bold" /> Retry · {gen.credits.amount} credits
          </button>
        )}
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
