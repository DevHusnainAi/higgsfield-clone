"use client";

import { ArrowCounterClockwise, FilmStrip, Heart, ImageSquare, SquaresFour } from "@phosphor-icons/react";
import type { Generation } from "@/lib/generation";
import { matchesFilter, select, setView, useStudio, type LibraryFilter } from "@/lib/store";
import { Shuffle } from "@phosphor-icons/react";
import { FavoriteButton } from "./favorite-button";
import { ResultMedia } from "./result-media";

const TITLES: Record<LibraryFilter, string> = { all: "All", images: "Images", videos: "Videos", favorites: "Favorites" };

const EMPTY = {
  all: { icon: SquaresFour, text: "Nothing here yet. Everything you generate lands in this library." },
  images: { icon: ImageSquare, text: "No images yet. Describe a photo, poster or illustration to make one." },
  videos: { icon: FilmStrip, text: "No videos yet. Mention a camera move, like slow dolly-in, to make one." },
  favorites: { icon: Heart, text: "No favorites yet. Heart a result to keep it here." },
} satisfies Record<LibraryFilter, unknown>;

function tileMeta(gen: Generation): string {
  if (gen.status === "done") return gen.demoFallback ? "Stock fallback, free" : `${gen.credits.amount} credits`;
  if (gen.status === "failed") return `Failed, ${gen.credits.amount} refunded`;
  if (gen.status === "generating") return `Generating ${Math.round(gen.progress * 100)}%`;
  return "Queued";
}

export function LibraryGrid({ filter, onRemix }: { filter: LibraryFilter; onRemix: (gen: Generation) => void }) {
  const { runs, favorites } = useStudio();
  const items = runs.filter((g) => matchesFilter(g, filter, favorites));

  if (items.length === 0) {
    const { icon: Icon, text } = EMPTY[filter];
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <div className="grid size-12 place-items-center rounded-xl border border-line bg-surface-raised inset-shadow-edge">
          <Icon size={22} className="text-fg-muted" />
        </div>
        <p className="max-w-[36ch] text-sm leading-relaxed text-fg-muted">{text}</p>
        <button
          onClick={() => (filter === "favorites" ? setView("all") : select(null))}
          className="h-9 rounded-full border border-line px-4 text-sm font-medium text-fg inset-shadow-edge transition hover:border-line-strong active:scale-[0.97]"
        >
          {filter === "favorites" ? "Browse library" : "Start creating"}
        </button>
      </div>
    );
  }

  return (
    <section aria-labelledby="library-title" className="flex flex-col gap-5">
      <h1 id="library-title" className="text-2xl font-semibold tracking-tight">
        {TITLES[filter]} <span className="text-fg-muted tabular-nums">{items.length}</span>
      </h1>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {items.map((gen) => {
          const fav = favorites.includes(gen.id);
          return (
            <li key={gen.id} className="group relative">
              <button
                onClick={() => select(gen.id)}
                className="flex w-full flex-col gap-2 text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent rounded-xl"
              >
                <div className="relative aspect-[4/5] w-full overflow-hidden rounded-xl border border-line bg-surface inset-shadow-edge">
                  {gen.status === "done" ? (
                    <ResultMedia url={gen.resultUrl} alt={gen.intent.prompt} sizes="(min-width: 768px) 220px, 50vw" className="transition duration-500 group-hover:scale-[1.03]" />
                  ) : gen.status === "failed" ? (
                    <div className="absolute inset-0 grid place-items-center">
                      <span className="flex items-center gap-1.5 text-xs text-fg-muted">
                        <ArrowCounterClockwise size={14} /> Credits returned
                      </span>
                    </div>
                  ) : (
                    <div className="shimmer absolute inset-0" />
                  )}
                </div>
                <span className="flex flex-col gap-0.5 px-0.5">
                  <span className="line-clamp-1 text-sm text-fg">{gen.intent.prompt}</span>
                  <span className={gen.status === "failed" ? "text-xs text-danger" : "text-xs text-fg-muted tabular-nums"}>
                    {tileMeta(gen)}
                  </span>
                </span>
              </button>
              {(gen.status === "done" || gen.status === "failed") && (
                <button
                  type="button"
                  onClick={() => onRemix(gen)}
                  aria-label="Remix"
                  title="Remix"
                  className="glass absolute left-2 top-2 grid size-8 place-items-center rounded-full border border-line text-fg-muted opacity-0 transition hover:text-fg focus-visible:opacity-100 group-hover:opacity-100 active:scale-[0.94]"
                >
                  <Shuffle size={14} weight="bold" />
                </button>
              )}
              {gen.status === "done" && (
                <FavoriteButton
                  id={gen.id}
                  active={fav}
                  className={`glass absolute right-2 top-2 ${fav ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`}
                />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
