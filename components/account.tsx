"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useState, type ReactNode } from "react";
import { CaretUpDown, EnvelopeSimple, GearSix, SignOut } from "@phosphor-icons/react";
import { remoteEnabled, signOut } from "@/lib/remote";
import { useStudio } from "@/lib/store";
import { anchor, anchoredTo, popoverClass } from "./param-chips";

/** The row plus a Settings gear beside it (a sibling: the row is itself a button or link, which can't nest). */
function WithSettings({ children, onNavigate }: { children: ReactNode; onNavigate?: () => void }) {
  const here = usePathname() === "/settings";
  return (
    <div className="mx-3 mb-3 flex shrink-0 items-center gap-1">
      {children}
      <Link
        href="/settings"
        onClick={onNavigate}
        aria-label="Settings"
        aria-current={here ? "page" : undefined}
        className="grid size-10 shrink-0 place-items-center rounded-xl text-fg-muted transition hover:bg-fg/[0.04] hover:text-fg active:scale-[0.98] aria-[current]:bg-fg/[0.06] aria-[current]:text-fg"
      >
        <GearSix size={17} weight={here ? "fill" : "regular"} />
      </Link>
    </div>
  );
}

/**
 * Bottom of the sidebar. Always the same height (skeleton while the session is read), so the sidebar never
 * shifts on load. Guest: a sign-in prompt. Signed in: name + a menu with Sign out. Both: a Settings gear.
 */
export function AccountRow({ onNavigate }: { onNavigate?: () => void }) {
  const { auth } = useStudio();
  const menu = `account-menu-${useId().replace(/:/g, "")}`; // unique per copy of the sidebar
  const [error, setError] = useState<string | null>(null);
  if (!remoteEnabled) return null;

  const row = "flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-xl px-3";

  if (auth.status === "unknown") {
    return (
      <div className={`${row} mx-3 mb-3`} aria-hidden>
        <span className="size-7 rounded-full bg-fg/[0.08] motion-safe:animate-pulse" />
        <span className="h-3 w-28 rounded bg-fg/[0.08] motion-safe:animate-pulse" />
      </div>
    );
  }

  if (auth.status === "anonymous") {
    return (
      // In-app link: intercepted into the sign-in modal over the studio (app/(studio)/@modal/(.)sign-in).
      <WithSettings onNavigate={onNavigate}>
        <Link
          href="/sign-in"
          scroll={false}
          onClick={onNavigate}
          className={`${row} border border-line text-left transition hover:border-line-strong hover:bg-fg/[0.04] active:scale-[0.98]`}
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent/15 text-accent-text">
            <EnvelopeSimple size={14} />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-ui font-medium text-fg">Sign in</span>
            <span className="truncate text-2xs text-fg-muted">
              {auth.pendingEmail ? `Confirm the link sent to ${auth.pendingEmail}` : "Save your work, get 40 credits"}
            </span>
          </span>
        </Link>
      </WithSettings>
    );
  }

  const label = auth.name ?? auth.email ?? "Your account";
  return (
    <WithSettings onNavigate={onNavigate}>
      <button
        type="button"
        popoverTarget={menu}
        style={anchor(`--${menu}`)}
        className={`${row} text-left transition hover:bg-fg/[0.04] active:scale-[0.98]`}
      >
        <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-hover text-ui font-semibold uppercase text-fg">
          {label.charAt(0)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-ui font-medium text-fg">{label}</span>
          {auth.name && auth.email && <span className="truncate text-2xs text-fg-muted">{auth.email}</span>}
        </span>
        <CaretUpDown size={14} className="shrink-0 text-fg-muted" aria-hidden />
        <span className="sr-only">, account menu</span>
      </button>
      <div id={menu} popover="auto" style={anchoredTo(`--${menu}`)} className={`${popoverClass} w-56`}>
        <p className="truncate px-2.5 pb-1.5 pt-1 text-xs text-fg-muted">{auth.email}</p>
        <button
          type="button"
          onClick={() => signOut().catch((err: Error) => setError(err.message))}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-ui text-fg-muted transition-colors hover:bg-fg/[0.06] hover:text-fg"
        >
          <SignOut size={14} /> Sign out
        </button>
        {error && <p role="alert" className="px-2.5 pb-1 text-xs text-danger">{error}</p>}
      </div>
    </WithSettings>
  );
}
