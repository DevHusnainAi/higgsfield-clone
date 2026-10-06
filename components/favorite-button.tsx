"use client";

import { Heart } from "@phosphor-icons/react";
import { toggleFavorite } from "@/lib/store";

export function FavoriteButton({ id, active, className = "" }: { id: string; active: boolean; className?: string }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        toggleFavorite(id);
      }}
      aria-pressed={active}
      aria-label={active ? "Remove from favorites" : "Add to favorites"}
      className={`grid size-8 place-items-center rounded-full border border-line text-fg-muted transition hover:border-line-strong hover:text-fg active:scale-[0.94] aria-pressed:text-accent-text ${className}`}
    >
      <Heart size={15} weight={active ? "fill" : "regular"} />
    </button>
  );
}
