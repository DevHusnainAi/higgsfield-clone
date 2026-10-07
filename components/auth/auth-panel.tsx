"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from "react";
import { ArrowLeft, CheckCircle, EnvelopeSimple, Eye, EyeSlash } from "@phosphor-icons/react";
import { emailCodes, remoteEnabled, sendMagicLink, sessionKind, signInWithGoogle, verifyCode, watchSignIn } from "@/lib/remote";
import type { Field, Mood } from "./creature";

/** Google's own "G", as their sign-in branding requires. */
const GoogleG = () => (
  <svg viewBox="0 0 48 48" className="size-[18px]" aria-hidden>
    <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z" />
    <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
  </svg>
);

/** What the stage badge says. Each value is only ever set by the event it names. */
export type AuthStatus = "idle" | "google" | "sending" | "waiting" | "signedIn" | "error";

export interface AuthSignals {
  onField: (f: Field) => void;
  onPeek: (peek: boolean) => void;
  onMood: (m: Mood) => void;
  onStatus: (s: AuthStatus) => void;
}

const RESEND_S = 60; // Supabase's default minimum interval between emails to one address

// Input text is 16px on phones (iOS zooms into anything smaller), the 13px UI base from md up.
// Form controls are recessed (inner shadow), buttons are raised (top-edge highlight). Radius rule: globals.css.
const input =
  "h-11 w-full rounded-xl border border-line-control bg-bg px-3 text-base text-fg md:text-ui shadow-[inset_0_1px_2px_oklch(0_0_0/0.35)] transition-colors placeholder:text-fg-muted focus-visible:border-accent/60 aria-invalid:border-danger";
const primary =
  "relative h-11 w-full overflow-hidden rounded-xl bg-accent text-sm font-medium text-accent-ink inset-shadow-edge transition hover:brightness-105 active:scale-[0.98] aria-busy:cursor-progress aria-busy:btn-busy disabled:opacity-60";
const textButton = "rounded-md text-ui text-fg-muted underline-offset-2 transition-colors hover:text-fg hover:underline aria-disabled:cursor-default aria-disabled:no-underline aria-disabled:opacity-70";
const label = "text-xs font-medium text-fg-muted";

/** Concentric rings while waiting for the email link; a check once this browser is signed in. */
function Radar({ done, ref }: { done: boolean; ref: RefObject<HTMLDivElement | null> }) {
  const ring = "absolute inset-0 rounded-full border-[1.5px] border-accent/40";
  return (
    <div ref={ref} aria-hidden className="relative grid size-16 place-items-center">
      {!done && (
        <>
          <span className={`${ring} motion-safe:animate-[radar_2.4s_cubic-bezier(0.2,0.6,0.35,1)_infinite] motion-reduce:scale-150 motion-reduce:opacity-30`} />
          <span className={`${ring} motion-safe:animate-[radar_2.4s_cubic-bezier(0.2,0.6,0.35,1)_1.2s_infinite] motion-safe:opacity-0 motion-reduce:hidden`} />
        </>
      )}
      <span className="relative grid size-16 place-items-center rounded-full bg-accent/15 text-accent-text">
        <EnvelopeSimple size={22} className={`absolute transition-opacity duration-200 ${done ? "opacity-0" : ""}`} />
        <CheckCircle size={24} weight="fill" className={`absolute transition-opacity duration-200 ${done ? "" : "opacity-0"}`} />
      </span>
    </div>
  );
}

/**
 * Passwordless sign-in: Google, or a magic link (Supabase's default email). After sending, a waiting state
 * that completes by itself when the link is opened in another tab of this browser. A 6-digit code entry is
 * offered only when NEXT_PUBLIC_EMAIL_CODES is on (the templates must include {{ .Token }}).
 */
export function AuthPanel({
  heading,
  onDone,
  emailRef,
  radarRef,
  signals,
}: {
  heading: "h1" | "h2";
  onDone: () => void;
  emailRef: RefObject<HTMLInputElement | null>;
  radarRef: RefObject<HTMLDivElement | null>;
  signals: AuthSignals;
}) {
  const id = useId();
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<"start" | "waiting" | "code">("start");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [sent, setSent] = useState<"upgrade" | "existing" | "signin" | null>(null);
  const [busy, setBusy] = useState<"google" | "email" | "code" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [signedIn, setSignedIn] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstView = useRef(true);
  const { onStatus, onMood, onField, onPeek } = signals;
  const Heading = heading;

  // Already signed in: nothing to do here. Until known, a skeleton (the server render is the same skeleton).
  useEffect(() => {
    void sessionKind().then((k) => (k === "user" ? onDone() : setReady(true)));
  }, [onDone]);

  // Completion from anywhere: the link opened in another tab, or a verified code.
  useEffect(
    () =>
      watchSignIn(() => {
        setSignedIn(true);
        onStatus("signedIn");
        onField(null);
        onMood({ kind: "happy", at: performance.now() });
        setTimeout(onDone, 900); // let the check and the hop land
      }),
    [onDone, onStatus, onField, onMood],
  );

  // A new view moves focus to its heading, so screen readers announce where they are.
  useEffect(() => {
    if (firstView.current) {
      firstView.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [view]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function run(kind: NonNullable<typeof busy>, status: AuthStatus, fn: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    onStatus(status);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      onStatus("error");
      onMood({ kind: "error", at: performance.now() });
    } finally {
      setBusy(null);
    }
  }

  const send = () =>
    run("email", "sending", async () => {
      setSent(await sendMagicLink(email.trim()));
      setView("waiting");
      setCooldown(RESEND_S);
      onStatus("waiting");
    });

  const verify = (e: FormEvent) => {
    e.preventDefault();
    void run("code", "waiting", () => verifyCode(email.trim(), code)); // success arrives through watchSignIn
  };

  const focusSignals = (f: Field) => ({ onFocus: () => onField(f), onBlur: () => onField(null) });
  const emailInput = (
    <input
      id={`${id}-email`}
      ref={emailRef}
      type="email"
      required
      autoComplete="email"
      value={email}
      onChange={(e) => setEmail(e.target.value)}
      aria-invalid={!!error && view === "start"}
      aria-describedby={error ? `${id}-error` : undefined}
      placeholder="you@company.com"
      className={input}
      {...focusSignals("email")}
    />
  );

  if (!remoteEnabled) {
    return (
      <div className="flex w-full max-w-[22rem] lg:max-w-[24rem] flex-col gap-2">
        <Heading className="text-2xl font-semibold tracking-display text-fg">Sign in</Heading>
        <p className="text-ui text-fg-muted">Accounts aren&rsquo;t set up on this server, so everything you make stays in this browser.</p>
      </div>
    );
  }

  if (!ready) {
    return (
      <div aria-busy className="flex w-full max-w-[22rem] lg:max-w-[24rem] flex-col gap-5">
        <span className="h-7 w-40 rounded-lg bg-fg/[0.06] motion-safe:animate-pulse" />
        <span className="h-11 rounded-xl bg-fg/[0.06] motion-safe:animate-pulse" />
        <span className="h-11 rounded-xl bg-fg/[0.06] motion-safe:animate-pulse" />
      </div>
    );
  }

  const title = view === "waiting" ? "Check your inbox" : view === "code" ? "Enter your code" : "Save your work";
  const errorText = error && (
    <p id={`${id}-error`} role="alert" className="text-ui text-danger [overflow-wrap:anywhere]">
      {error}
    </p>
  );

  return (
    <div className="flex w-full max-w-[22rem] lg:max-w-[24rem] flex-col gap-5">
      {view === "waiting" && <Radar ref={radarRef} done={signedIn} />}
      <header className="flex flex-col gap-2">
        <Heading ref={headingRef} tabIndex={-1} className="text-2xl font-semibold tracking-display text-fg outline-none">
          {title}
        </Heading>
        <p className="text-ui text-pretty text-fg-muted">
          {view === "waiting" ? (
            sent === "existing" ? (
              <>
                That email already has an account. We sent a sign-in link to <strong className="font-medium text-fg [overflow-wrap:anywhere]">{email}</strong>. Open it in this browser and your work from this visit moves over.
              </>
            ) : (
              <>
                We sent a sign-in link to <strong className="font-medium text-fg [overflow-wrap:anywhere]">{email}</strong>.{" "}
                {sent === "upgrade" ? "Open it in this browser to confirm your email. Your history and credits stay as they are." : "Open it in this browser to sign in and keep your history."}
              </>
            )
          ) : view === "code" ? (
            "Use the 6-digit code from your sign-in email."
          ) : (
            "Keep your history on every device. New accounts get 40 free credits."
          )}
        </p>
      </header>

      {view === "start" && (
        <>
          <button
            type="button"
            disabled={busy !== null}
            aria-busy={busy === "google"}
            onClick={() => void run("google", "google", signInWithGoogle)}
            // Google's dark-theme branding values: #131314 fill, #8E918F stroke, #E3E3E3 text.
            className="flex h-11 items-center justify-center gap-2.5 rounded-xl border border-[#8E918F] bg-[#131314] text-sm font-medium text-[#E3E3E3] inset-shadow-edge transition hover:bg-[#1b1b1d] active:scale-[0.98] disabled:opacity-60"
          >
            <GoogleG /> Continue with Google
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
            <label htmlFor={`${id}-email`} className={label}>Email</label>
            {emailInput}
            {errorText}
            <button type="submit" disabled={busy !== null} aria-busy={busy === "email"} className={`${primary} mt-2`}>
              {busy === "email" ? "Sending link" : "Email me a sign-in link"}
            </button>
          </form>
          {emailCodes && (
            <button type="button" onClick={() => setView("code")} className={`${textButton} self-start`}>
              Have a code? Enter it
            </button>
          )}
        </>
      )}

      {view === "waiting" && (
        <>
          <p role="status" className="text-ui font-medium text-fg">
            {signedIn ? "You're signed in" : "Waiting for you to open the link"}
          </p>
          {errorText}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <button
              type="button"
              onClick={() => {
                setView("start");
                setSent(null);
                setError(null);
                onStatus("idle");
              }}
              className={`${textButton} flex items-center gap-1.5`}
            >
              <ArrowLeft size={12} aria-hidden /> Use a different email
            </button>
            <button
              type="button"
              aria-disabled={cooldown > 0 || busy !== null}
              onClick={() => cooldown <= 0 && busy === null && void send()}
              className={`${textButton} tabular-nums`}
            >
              {cooldown > 0 ? (
                <>
                  Resend link in <span className="font-mono">{cooldown}s</span>
                </>
              ) : (
                "Resend link"
              )}
            </button>
          </div>
          {/* Announced once, when resending becomes possible (the countdown itself isn't read out every second). */}
          <p aria-live="polite" className="sr-only">
            {cooldown === 0 && sent ? "You can resend the link now." : ""}
          </p>
          {emailCodes && (
            <button type="button" onClick={() => setView("code")} className={`${textButton} self-start`}>
              Opened the email on another device? Enter the code instead
            </button>
          )}
        </>
      )}

      {view === "code" && (
        <form onSubmit={verify} className="flex flex-col gap-2">
          {!sent && (
            <div className="mb-3 flex flex-col gap-2">
              <label htmlFor={`${id}-email`} className={label}>Email</label>
              {emailInput}
            </div>
          )}
          <label htmlFor={`${id}-code`} className={label}>6-digit code</label>
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
              aria-invalid={!!error}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              // Masked unless shown: a code read over someone's shoulder is a sign-in.
              className={`${input} pr-12 font-mono tracking-[0.5em] tabular-nums ${showCode ? "" : "[-webkit-text-security:disc]"}`}
              {...focusSignals("code")}
            />
            <button
              type="button"
              onClick={() => {
                setShowCode((s) => !s);
                onPeek(!showCode);
              }}
              aria-pressed={showCode}
              aria-label={showCode ? "Hide code" : "Show code"}
              className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-fg-muted transition hover:bg-fg/[0.06] hover:text-fg"
            >
              {showCode ? <EyeSlash size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {errorText}
          <button type="submit" disabled={busy !== null || code.length !== 6} aria-busy={busy === "code"} className={`${primary} mt-2`}>
            {busy === "code" ? "Checking code" : "Sign in"}
          </button>
          <button
            type="button"
            onClick={() => {
              setView(sent ? "waiting" : "start");
              setCode("");
              setError(null);
            }}
            className={`${textButton} mt-1 flex items-center gap-1.5 self-start`}
          >
            <ArrowLeft size={12} aria-hidden /> Back
          </button>
        </form>
      )}

      {/* 20px gap + 12px: the legal line reads as a footnote, apart from the form. */}
      <p className="mt-3 text-xs text-fg-muted">
        By continuing you agree to the{" "}
        <Link href="/terms" className="rounded-sm text-fg underline underline-offset-2">Terms</Link> and{" "}
        <Link href="/privacy" className="rounded-sm text-fg underline underline-offset-2">Privacy Policy</Link>.
      </p>
    </div>
  );
}
