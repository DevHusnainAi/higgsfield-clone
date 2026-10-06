"use client";

import Link from "next/link";
import { useEffect, useId, useState, type FormEvent, type RefObject } from "react";
import { ArrowLeft, Eye, EyeSlash } from "@phosphor-icons/react";
import { sendMagicLink, sessionKind, signInWithGoogle, verifyCode } from "@/lib/remote";
import type { Field, Mood } from "./creature";

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
  upgrade: "Open the link to confirm your email, or enter the 6-digit code from the same email. Your history and credits stay exactly as they are.",
  existing: "That email already has an account. Open the link, or enter the 6-digit code, to sign in; your work from this visit moves over.",
  signin: "Open the link, or enter the 6-digit code from the same email.",
} as const;

const RESEND_S = 60; // Supabase's default minimum interval between emails to one address

const field = "h-11 w-full rounded-xl border border-line-control bg-bg px-3 text-base text-fg placeholder:text-fg-muted";
const primary = "h-11 w-full rounded-xl bg-accent text-sm font-medium text-accent-ink transition hover:brightness-105 active:scale-[0.98] disabled:opacity-60";
const textButton = "text-ui text-fg-muted underline-offset-2 transition hover:text-fg hover:underline";

export interface AuthSignals {
  onField: (f: Field) => void;
  onPeek: (peek: boolean) => void;
  onMood: (m: Mood) => void;
}

/**
 * Passwordless sign-in: Google, or one email that carries both a link and a 6-digit code (the code is for
 * signing in on a different device than the one reading the email). Shared by the modal and the full page.
 */
export function AuthPanel({ heading, onDone, emailRef, signals }: { heading: "h1" | "h2"; onDone: () => void; emailRef: RefObject<HTMLInputElement | null>; signals: AuthSignals }) {
  const id = useId();
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<"start" | "code">("start");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [sent, setSent] = useState<keyof typeof SENT | null>(null);
  const [busy, setBusy] = useState<"google" | "email" | "code" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const Heading = heading;

  // Already signed in: nothing to do here. Until known, a skeleton (the server render is the same skeleton).
  useEffect(() => {
    void sessionKind().then((k) => (k === "user" ? onDone() : setReady(true)));
  }, [onDone]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function run(kind: NonNullable<typeof busy>, fn: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      signals.onMood({ kind: "error", at: performance.now() });
    } finally {
      setBusy(null);
    }
  }

  const send = () =>
    run("email", async () => {
      setSent(await sendMagicLink(email.trim()));
      setView("code");
      setCooldown(RESEND_S);
      signals.onMood({ kind: "happy", at: performance.now() });
    });

  const verify = (e: FormEvent) => {
    e.preventDefault();
    void run("code", async () => {
      await verifyCode(email.trim(), code);
      signals.onField(null);
      signals.onMood({ kind: "happy", at: performance.now() });
      setTimeout(onDone, 700); // let the happy hop land
    });
  };

  const focusSignals = (f: Field) => ({ onFocus: () => signals.onField(f), onBlur: () => signals.onField(null) });

  if (!ready) {
    return (
      <div aria-busy className="flex w-full max-w-sm flex-col gap-4">
        <span className="h-7 w-40 rounded-lg bg-fg/[0.06] motion-safe:animate-pulse" />
        <span className="h-11 rounded-xl bg-fg/[0.06] motion-safe:animate-pulse" />
        <span className="h-11 rounded-xl bg-fg/[0.06] motion-safe:animate-pulse" />
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-5">
      <header className="flex flex-col gap-1.5">
        <Heading className="text-2xl font-semibold tracking-display text-fg">{view === "code" && sent ? "Check your inbox" : "Save your work"}</Heading>
        <p className="text-ui text-fg-muted">
          {view === "code" && sent ? (
            <>
              We sent an email to <strong className="font-medium text-fg [overflow-wrap:anywhere]">{email}</strong>. {SENT[sent]}
            </>
          ) : view === "code" ? (
            "Enter your email and the 6-digit code from your sign-in email."
          ) : (
            "Keep your history on every device and get 40 free credits."
          )}
        </p>
      </header>

      {view === "start" ? (
        <>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void run("google", signInWithGoogle)}
            className="flex h-11 items-center justify-center gap-2.5 rounded-xl border border-line-control bg-surface text-sm font-medium text-fg transition hover:bg-surface-hover active:scale-[0.98] disabled:opacity-60"
          >
            <GoogleG /> {busy === "google" ? "Opening Google…" : "Continue with Google"}
          </button>
          <div className="flex items-center gap-3 text-xs text-fg-muted" aria-hidden>
            <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="flex flex-col gap-2"
          >
            <label htmlFor={`${id}-email`} className="text-xs font-medium text-fg-muted">Work email</label>
            <input
              id={`${id}-email`}
              ref={emailRef}
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className={field}
              {...focusSignals("email")}
            />
            <button type="submit" disabled={busy !== null} className={`${primary} mt-1`}>
              {busy === "email" ? "Sending…" : "Email me a sign-in link"}
            </button>
          </form>
          <button type="button" onClick={() => setView("code")} className={`${textButton} self-start`}>
            Have a code? Enter it
          </button>
        </>
      ) : (
        <form onSubmit={verify} className="flex flex-col gap-2">
          {!sent && (
            <>
              <label htmlFor={`${id}-email`} className="text-xs font-medium text-fg-muted">Work email</label>
              <input
                id={`${id}-email`}
                ref={emailRef}
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className={`${field} mb-2`}
                {...focusSignals("email")}
              />
            </>
          )}
          <label htmlFor={`${id}-code`} className="text-xs font-medium text-fg-muted">6-digit code</label>
          <div className="relative">
            <input
              id={`${id}-code`}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              // Masked unless shown: a code read over someone's shoulder is a sign-in.
              className={`${field} pr-12 font-mono tracking-[0.5em] tabular-nums ${showCode ? "" : "[-webkit-text-security:disc]"}`}
              {...focusSignals("code")}
            />
            <button
              type="button"
              onClick={() => {
                setShowCode((s) => !s);
                signals.onPeek(!showCode);
              }}
              aria-pressed={showCode}
              aria-label={showCode ? "Hide code" : "Show code"}
              className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-fg-muted transition hover:bg-fg/[0.06] hover:text-fg"
            >
              {showCode ? <EyeSlash size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <button type="submit" disabled={busy !== null || code.length !== 6} className={`${primary} mt-1`}>
            {busy === "code" ? "Checking…" : "Verify and sign in"}
          </button>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <button
              type="button"
              onClick={() => {
                setView("start");
                setSent(null);
                setCode("");
                setError(null);
              }}
              className={`${textButton} flex items-center gap-1.5`}
            >
              <ArrowLeft size={12} aria-hidden /> {sent ? "Use a different email" : "Back"}
            </button>
            {sent && (
              <button type="button" disabled={cooldown > 0 || busy !== null} onClick={() => void send()} className={`${textButton} tabular-nums disabled:no-underline disabled:opacity-60`}>
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend email"}
              </button>
            )}
          </div>
        </form>
      )}

      {error && <p role="alert" className="text-ui text-danger [overflow-wrap:anywhere]">{error}</p>}
      <p className="text-xs text-fg-muted">
        No password needed. Runs you made before signing in come with you. By continuing you agree to the{" "}
        <Link href="/terms" className="text-fg underline underline-offset-2">Terms</Link> and{" "}
        <Link href="/privacy" className="text-fg underline underline-offset-2">Privacy Policy</Link>.
      </p>
    </div>
  );
}
