"use client";

import type { ComponentType } from "react";
import { FilmStrip, Heart, ImageSquare, Plus, Sparkle, SquaresFour, type IconProps } from "@phosphor-icons/react";
import { matchesFilter, select, setView, useStudio, type LibraryFilter, type View } from "@/lib/store";

const LIBRARY: { filter: LibraryFilter; label: string; icon: ComponentType<IconProps> }[] = [
  { filter: "all", label: "All", icon: SquaresFour },
  { filter: "images", label: "Images", icon: ImageSquare },
  { filter: "videos", label: "Videos", icon: FilmStrip },
  { filter: "favorites", label: "Favorites", icon: Heart },
];

function newGeneration() {
  select(null);
  document.getElementById("prompt")?.focus();
}

function NavItem({
  active,
  onClick,
  icon: Icon,
  label,
  trailing,
}: {
  active: boolean;
  onClick: () => void;
  icon: ComponentType<IconProps>;
  label: string;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className="group relative flex h-9 w-full items-center gap-2.5 rounded-xl px-3 text-sm text-fg-muted transition-colors hover:bg-fg/[0.04] hover:text-fg aria-[current]:bg-fg/[0.06] aria-[current]:text-fg aria-[current]:inset-shadow-edge before:absolute before:inset-y-2 before:-left-3 before:w-0.5 before:rounded-full before:bg-accent before:opacity-0 aria-[current]:before:opacity-100"
    >
      <Icon size={17} weight={active ? "fill" : "regular"} className="shrink-0" />
      <span className="flex-1 text-left">{label}</span>
      {trailing}
    </button>
  );
}

export function StudioSidebar() {
  const { runs, favorites, view, sessionStart } = useStudio();
  const running = runs.filter((g) => g.status === "queued" || g.status === "generating").length;

  let used = 0, refunded = 0, held = 0;
  for (const g of runs) {
    if (g.createdAt < sessionStart) continue;
    if (g.credits.state === "charged") used += g.credits.amount;
    else if (g.credits.state === "refunded") refunded += g.credits.amount;
    else held += g.credits.amount;
  }

  const isActive = (v: View) => view === v;

  return (
    <aside className="sticky top-0 hidden h-[100dvh] w-64 shrink-0 flex-col border-r border-line bg-surface md:flex">
      <div className="flex h-16 shrink-0 items-center justify-between px-5">
        <span className="text-[15px] font-semibold tracking-tight">Studio</span>
        <button
          onClick={newGeneration}
          aria-label="New generation"
          className="grid size-8 place-items-center rounded-full border border-line text-fg-muted inset-shadow-edge transition hover:border-line-strong hover:text-fg active:scale-[0.96]"
        >
          <Plus size={14} weight="bold" />
        </button>
      </div>

      <nav aria-label="Studio" className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-3 pt-1">
        <NavItem
          active={isActive("create")}
          onClick={() => setView("create")}
          icon={Sparkle}
          label="Create"
          trailing={
            running > 0 && (
              <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium tabular-nums text-accent-text">
                {running} running
              </span>
            )
          }
        />

        <div className="flex flex-col gap-0.5">
          <h2 className="px-3 pb-1.5 text-xs font-medium text-fg-muted">Library</h2>
          {LIBRARY.map(({ filter, label, icon }) => (
            <NavItem
              key={filter}
              active={isActive(filter)}
              onClick={() => setView(filter)}
              icon={icon}
              label={label}
              trailing={
                <span className="text-xs tabular-nums text-fg-muted">
                  {runs.filter((g) => matchesFilter(g, filter, favorites)).length}
                </span>
              }
            />
          ))}
        </div>
      </nav>

      <div className="m-3 rounded-xl border border-line bg-surface-raised p-3 inset-shadow-edge">
        <h2 className="pb-2 text-xs font-medium text-fg-muted">This session</h2>
        <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm">
          <dt className="text-fg-muted">Credits used</dt>
          <dd className="text-right tabular-nums text-fg">{used}</dd>
          <dt className="text-fg-muted">Refunded</dt>
          <dd className="text-right tabular-nums text-fg">{refunded}</dd>
          {held > 0 && (
            <>
              <dt className="text-fg-muted">On hold</dt>
              <dd className="text-right tabular-nums text-accent-text">{held}</dd>
            </>
          )}
        </dl>
      </div>
    </aside>
  );
}
