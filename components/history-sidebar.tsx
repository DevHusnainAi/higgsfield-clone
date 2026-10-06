"use client";

import { useRef, type ComponentType, type ReactNode } from "react";
import { FilmStrip, Heart, ImageSquare, List, Plus, Sparkle, SquaresFour, Terminal, X, type IconProps } from "@phosphor-icons/react";
import { setDevConsole, useDevConsoleOpen } from "@/lib/dev-log";
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

const iconButton =
  "grid size-8 place-items-center rounded-full border border-line text-fg-muted inset-shadow-edge transition hover:border-line-strong hover:text-fg active:scale-[0.96]";

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
  trailing?: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className="group relative flex h-10 w-full items-center gap-2.5 rounded-xl px-3 text-sm text-fg-muted transition-colors hover:bg-fg/[0.04] hover:text-fg aria-[current]:bg-fg/[0.06] aria-[current]:text-fg aria-[current]:inset-shadow-edge before:absolute before:inset-y-2 before:-left-3 before:w-0.5 before:rounded-full before:bg-accent before:opacity-0 aria-[current]:before:opacity-100 md:h-9"
    >
      <Icon size={17} weight={active ? "fill" : "regular"} className="shrink-0" />
      <span className="flex-1 text-left">{label}</span>
      {trailing}
    </button>
  );
}

/** Shared by the desktop sidebar and the mobile drawer. `onNavigate` closes the drawer. */
function SidebarBody({ onNavigate, onClose }: { onNavigate?: () => void; onClose?: () => void }) {
  const { runs, favorites, view, sessionStart, balance } = useStudio();
  const devConsole = useDevConsoleOpen();
  const running = runs.filter((g) => g.status === "queued" || g.status === "generating").length;
  const go = (fn: () => void) => () => {
    fn();
    onNavigate?.();
  };

  let used = 0, refunded = 0, held = 0;
  for (const g of runs) {
    if (g.createdAt < sessionStart) continue;
    if (g.credits.state === "charged") used += g.credits.amount;
    else if (g.credits.state === "refunded") refunded += g.credits.amount;
    else held += g.credits.amount;
  }

  const isActive = (v: View) => view === v;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center justify-between gap-2 px-5">
        <span className="flex-1 text-[15px] font-semibold tracking-tight">Studio</span>
        <button onClick={go(newGeneration)} aria-label="New generation" className={iconButton}>
          <Plus size={14} weight="bold" />
        </button>
        {onClose && (
          <button onClick={onClose} aria-label="Close menu" className={iconButton}>
            <X size={14} weight="bold" />
          </button>
        )}
      </div>

      <nav aria-label="Studio" className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-3 pt-1">
        <NavItem
          active={isActive("create")}
          onClick={go(() => setView("create"))}
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
              onClick={go(() => setView(filter))}
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
        <div className="flex items-center justify-between pb-2">
          <h2 className="text-xs font-medium text-fg-muted">Credits</h2>
          <button
            type="button"
            onClick={() => setDevConsole(!devConsole)}
            aria-pressed={devConsole}
            aria-label="Dev console"
            title="Dev console: live pipeline events"
            className="-my-1 grid size-6 place-items-center rounded-md text-fg-muted transition hover:bg-fg/[0.06] hover:text-fg aria-pressed:bg-accent/15 aria-pressed:text-accent-text"
          >
            <Terminal size={13} />
          </button>
        </div>
        <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm">
          {balance !== null && (
            <>
              <dt className="text-fg-muted">Balance</dt>
              <dd className="text-right font-medium tabular-nums text-fg">{balance}</dd>
            </>
          )}
          <dt className="text-fg-muted">Used this session</dt>
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
    </div>
  );
}

function MobileBar() {
  const drawer = useRef<HTMLDialogElement>(null);
  const close = () => drawer.current?.close();
  const { runs } = useStudio();
  const running = runs.some((g) => g.status === "queued" || g.status === "generating");

  return (
    <header className="glass sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b border-line px-3 md:hidden">
      <button onClick={() => drawer.current?.showModal()} aria-label="Open menu" aria-haspopup="dialog" className={`relative ${iconButton} size-10`}>
        <List size={18} />
        {running && (
          <>
            <span aria-hidden className="absolute right-1.5 top-1.5 size-2 rounded-full bg-accent" />
            <span className="sr-only">, a generation is running</span>
          </>
        )}
      </button>
      <span className="text-[15px] font-semibold tracking-tight">Studio</span>
      <button onClick={newGeneration} aria-label="New generation" className={`${iconButton} size-10`}>
        <Plus size={16} weight="bold" />
      </button>

      {/* Native modal: focus trap, Esc to close, top layer. Clicking the backdrop hits the dialog itself. */}
      <dialog
        ref={drawer}
        aria-label="Studio menu"
        onClick={(e) => e.target === e.currentTarget && close()}
        className="m-0 h-dvh max-h-none w-72 max-w-[85vw] border-r border-line bg-surface p-0 text-fg backdrop:bg-[oklch(0.08_0.01_260/0.6)] -translate-x-full open:translate-x-0 starting:open:-translate-x-full transition-[translate,overlay,display] transition-discrete duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
      >
        <SidebarBody onNavigate={close} onClose={close} />
      </dialog>
    </header>
  );
}

export function StudioSidebar() {
  return (
    <>
      <aside className="sticky top-0 hidden h-[100dvh] w-64 shrink-0 border-r border-line bg-surface md:block">
        <SidebarBody />
      </aside>
      <MobileBar />
    </>
  );
}
