"use client";

import Image from "next/image";
import { useRef, type ComponentType, type ReactNode } from "react";
import { CheckCircle, CircleNotch, FilmStrip, Heart, ImageSquare, List, Plus, Sparkle, SquaresFour, Terminal, WarningCircle, X, type IconProps } from "@phosphor-icons/react";
import { AccountRow } from "@/components/account";
import { Logo } from "@/components/logo";
import { isVideo } from "@/components/result-media";
import type { Generation } from "@/lib/generation";
import { setDevConsole, useDevConsoleOpen } from "@/lib/dev-log";
import { remoteEnabled } from "@/lib/remote";
import { matchesFilter, select, setView, useStudio, type LibraryFilter, type View } from "@/lib/store";

const RECENT = 8;

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
  "grid size-8 place-items-center rounded-full border border-line text-fg-muted inset-shadow-edge transition hover:border-line-strong hover:text-fg active:scale-[0.98]";

// ponytail: computed at render, so it only advances when the store updates; add a minute ticker if stale labels matter
function ago(ms: number) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** Status as icon + word, never colour alone. */
function status(g: Generation): { icon: ComponentType<IconProps>; label: string; tone: string; spin?: boolean } {
  if (g.status === "failed") return { icon: WarningCircle, label: "Failed", tone: "text-danger" };
  if (g.status === "done") return { icon: CheckCircle, label: g.demoFallback ? "Stock" : "Done", tone: "text-fg-muted" };
  return { icon: CircleNotch, label: g.status === "queued" ? "Queued" : `${Math.round(g.progress * 100)}%`, tone: "text-accent-text", spin: true };
}

function Thumb({ g }: { g: Generation }) {
  const Fallback = g.intent.media === "video" ? FilmStrip : ImageSquare;
  return (
    <span className="relative grid size-7 shrink-0 place-items-center overflow-hidden rounded-md border border-line bg-stage text-fg-muted">
      {g.status === "done" && !isVideo(g.resultUrl) ? (
        <Image src={g.resultUrl} alt="" fill sizes="28px" className="object-cover" />
      ) : (
        <Fallback size={13} aria-hidden />
      )}
    </span>
  );
}

function RecentRuns({ go }: { go: (fn: () => void) => () => void }) {
  const { runs, selectedId, view } = useStudio();
  // One row per run: a 4-output batch shows its first output, not four rows.
  const seen = new Set<string>();
  const recent: { g: Generation; outputs: number }[] = [];
  for (const g of runs) {
    const key = g.batchId ?? g.id;
    if (seen.has(key)) continue;
    seen.add(key);
    recent.push({ g, outputs: g.batchId ? runs.filter((r) => r.batchId === g.batchId).length : 1 });
    if (recent.length === RECENT) break;
  }

  return (
    <section aria-labelledby="recent-heading" className="flex flex-col gap-0.5">
      <h2 id="recent-heading" className="px-3 pb-1.5 text-xs font-medium text-fg-muted">Recent</h2>
      {recent.length === 0 ? (
        <p className="px-3 text-xs text-fg-muted">Runs you start appear here.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {recent.map(({ g, outputs }) => {
            const s = status(g);
            const current = view === "create" && (selectedId === g.id || (!!g.batchId && runs.some((r) => r.id === selectedId && r.batchId === g.batchId)));
            return (
              <li key={g.id}>
                <button
                  onClick={go(() => select(g.id))}
                  aria-current={current ? "true" : undefined}
                  className="flex w-full min-w-0 items-center gap-2.5 rounded-lg px-3 py-1.5 text-left transition-colors hover:bg-fg/[0.04] aria-[current]:bg-surface-hover aria-[current]:inset-shadow-edge"
                >
                  <Thumb g={g} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    {/* Full prompt stays in the DOM, so the accessible name is never truncated; only the paint is clamped. */}
                    <span className="line-clamp-1 text-ui text-fg [overflow-wrap:anywhere]">{g.intent.prompt || "Untitled"}</span>
                    <span className="flex items-center gap-1 text-2xs tabular-nums text-fg-muted">
                      <s.icon size={11} aria-hidden className={`shrink-0 ${s.tone} ${s.spin ? "motion-safe:animate-spin" : ""}`} />
                      <span className={s.tone}>{s.label}</span>
                      {outputs > 1 && <span>×{outputs}</span>}
                      <span className="ml-auto shrink-0">{ago(g.createdAt)}</span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
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
  trailing?: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className="group relative flex h-10 w-full items-center gap-2.5 rounded-xl px-3 text-ui text-fg-muted transition-colors hover:bg-fg/[0.04] hover:text-fg aria-[current]:bg-fg/[0.06] aria-[current]:text-fg aria-[current]:inset-shadow-edge before:absolute before:inset-y-2 before:-left-3 before:w-0.5 before:rounded-full before:bg-accent before:opacity-0 aria-[current]:before:opacity-100 md:h-9"
    >
      <Icon size={17} weight={active ? "fill" : "regular"} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
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
        <span className="flex flex-1 items-center gap-2 text-[15px] font-semibold tracking-tight">
          <Logo /> Intent Studio
        </span>
        <button onClick={go(newGeneration)} aria-label="New generation" className={iconButton}>
          <Plus size={14} weight="bold" />
        </button>
        {onClose && (
          <button onClick={onClose} aria-label="Close menu" className={iconButton}>
            <X size={14} weight="bold" />
          </button>
        )}
      </div>

      <nav aria-label="Studio" className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-3 pt-1 pb-2">
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

        <RecentRuns go={go} />
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
        {/* Every row renders from the first paint (placeholders until data lands), so the box never changes height. */}
        <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-ui">
          {remoteEnabled && (
            <>
              <dt className="text-fg-muted">Balance</dt>
              <dd className="text-right font-medium tabular-nums text-fg">
                {balance ?? (
                  <span aria-label="Loading" className="inline-block h-3 w-8 rounded bg-fg/[0.08] align-middle motion-safe:animate-pulse" />
                )}
              </dd>
            </>
          )}
          <dt className="text-fg-muted">Used this session</dt>
          <dd className="text-right tabular-nums text-fg">{used}</dd>
          <dt className="text-fg-muted">Refunded</dt>
          <dd className="text-right tabular-nums text-fg">{refunded}</dd>
          <dt className="text-fg-muted">On hold</dt>
          <dd className={`text-right tabular-nums ${held > 0 ? "text-accent-text" : "text-fg-muted"}`}>{held}</dd>
        </dl>
      </div>
      <AccountRow />
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
      <span className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
        <Logo /> Intent Studio
      </span>
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
