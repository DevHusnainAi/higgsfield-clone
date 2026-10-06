"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { CaretUpDown, EnvelopeSimple, SignOut, X } from "@phosphor-icons/react";
import { remoteEnabled, sendMagicLink, signInWithGoogle, signOut } from "@/lib/remote";
import { useStudio } from "@/lib/store";
import { anchor, anchoredTo, popoverClass } from "./param-chips";

/** Google's own "G", as their sign-in branding asks for. */
const GoogleG = () => (
  <svg viewBox="0 0 48 48" className="size-4" aria-hidden>
    <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z" />
    <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
  </svg>
);

const SENT = {
  upgrade: "Open the link we sent to confirm your email. Your history and credits stay exactly as they are.",
  existing: "That email already has an account. Open the link we sent to sign in; your work from this visit moves over.",
  signin: "Open the link we sent to sign in.",
} as const;

function SignInDialog({ dialog }: { dialog: React.RefObject<HTMLDialogElement | null> }) {
  const id = useId(); // the sidebar renders twice (desktop + mobile drawer): ids must be unique
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<"google" | "email" | null>(null);
  const [sent, setSent] = useState<keyof typeof SENT | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: "google" | "email", fn: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const onEmail = (e: FormEvent) => {
    e.preventDefault();
    void run("email", async () => setSent(await sendMagicLink(email.trim())));
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      onClick={(e) => e.target === e.currentTarget && dialog.current?.close()}
      className="m-auto w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface-raised p-0 text-fg shadow-float inset-shadow-edge backdrop:bg-[oklch(0.08_0.01_260/0.6)]"
    >
      <div className="flex flex-col gap-5 p-6">
        <header className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 id={`${id}-title`} className="text-lg font-semibold tracking-heading">Save your work</h2>
            <p className="text-ui text-fg-muted">Keep your history on every device and get 40 free credits.</p>
          </div>
          <button type="button" onClick={() => dialog.current?.close()} aria-label="Close" className="-m-1 grid size-8 shrink-0 place-items-center rounded-full text-fg-muted transition hover:bg-fg/[0.06] hover:text-fg active:scale-[0.98]">
            <X size={14} weight="bold" />
          </button>
        </header>

        {sent ? (
          <p role="status" className="flex items-start gap-2.5 rounded-xl border border-line bg-surface p-3 text-ui">
            <EnvelopeSimple size={18} className="mt-px shrink-0 text-accent-text" />
            <span>
              <strong className="font-medium">Check {email}.</strong> {SENT[sent]}
            </span>
          </p>
        ) : (
          <>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void run("google", signInWithGoogle)}
              className="flex h-11 items-center justify-center gap-2.5 rounded-xl border border-line-control bg-surface text-sm font-medium transition hover:bg-surface-hover active:scale-[0.98] disabled:opacity-60"
            >
              <GoogleG /> {busy === "google" ? "Opening Google…" : "Continue with Google"}
            </button>
            <div className="flex items-center gap-3 text-xs text-fg-muted" aria-hidden>
              <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
            </div>
            <form onSubmit={onEmail} className="flex flex-col gap-2">
              <label htmlFor={`${id}-email`} className="text-xs font-medium text-fg-muted">Work email</label>
              <input
                id={`${id}-email`}
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="h-11 rounded-xl border border-line-control bg-bg px-3 text-base text-fg placeholder:text-fg-muted"
              />
              <button type="submit" disabled={busy !== null} className="h-11 rounded-xl bg-accent text-sm font-medium text-accent-ink transition hover:brightness-105 active:scale-[0.98] disabled:opacity-60">
                {busy === "email" ? "Sending…" : "Email me a sign-in link"}
              </button>
            </form>
          </>
        )}
        {error && <p role="alert" className="text-ui text-danger [overflow-wrap:anywhere]">{error}</p>}
        <p className="text-xs text-fg-muted">No password needed. Runs you made before signing in come with you.</p>
      </div>
    </dialog>
  );
}

/**
 * Bottom of the sidebar. Always the same height (skeleton while the session is read), so the sidebar never
 * shifts on load. Guest: a sign-in prompt. Signed in: name + a menu with Sign out.
 */
export function AccountRow() {
  const { auth } = useStudio();
  const dialog = useRef<HTMLDialogElement>(null);
  const menu = `account-menu-${useId().replace(/:/g, "")}`; // unique per copy of the sidebar
  const [error, setError] = useState<string | null>(null);
  if (!remoteEnabled) return null;

  const row = "mx-3 mb-3 flex h-12 shrink-0 items-center gap-2.5 rounded-xl px-3";

  if (auth.status === "unknown") {
    return (
      <div className={row} aria-hidden>
        <span className="size-7 rounded-full bg-fg/[0.08] motion-safe:animate-pulse" />
        <span className="h-3 w-28 rounded bg-fg/[0.08] motion-safe:animate-pulse" />
      </div>
    );
  }

  if (auth.status === "anonymous") {
    return (
      <>
        <button
          type="button"
          onClick={() => dialog.current?.showModal()}
          className={`${row} w-[calc(100%-1.5rem)] border border-line text-left transition hover:border-line-strong hover:bg-fg/[0.04] active:scale-[0.98]`}
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
        </button>
        <SignInDialog dialog={dialog} />
      </>
    );
  }

  const label = auth.name ?? auth.email ?? "Your account";
  return (
    <>
      <button
        type="button"
        popoverTarget={menu}
        style={anchor(`--${menu}`)}
        className={`${row} w-[calc(100%-1.5rem)] text-left transition hover:bg-fg/[0.04] active:scale-[0.98]`}
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
    </>
  );
}
