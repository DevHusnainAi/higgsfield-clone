"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { ArrowLeft, Check, X } from "@phosphor-icons/react";
import { Logo } from "@/components/logo";
import { AuthPanel, type AuthStatus } from "./auth-panel";
import { Creature, type Field, type Mood } from "./creature";

/** The stage badge, by status. Nothing while idle: the pill only appears when there is real state to report. */
const BADGE: Record<Exclude<AuthStatus, "idle">, { label: string; tone: "live" | "done" | "error" }> = {
  google: { label: "Opening Google sign-in", tone: "live" },
  sending: { label: "Sending your link", tone: "live" },
  waiting: { label: "Waiting for you to open the link", tone: "live" },
  signedIn: { label: "Signed in. Taking you back", tone: "done" },
  error: { label: "Sign-in failed", tone: "error" },
};

/** Something is in flight: Iris's forehead spark pulses while it lasts. */
const LIVE = new Set<AuthStatus>(["google", "sending", "waiting"]);

/**
 * Floating glass status pill. The dot shows real state (pulsing while something is in flight), the only
 * kind of dot the design rules allow. aria-hidden: the form's own status line announces the same thing.
 */
function StatusBadge({ status }: { status: AuthStatus }) {
  if (status === "idle") return null;
  const { label, tone } = BADGE[status];
  return (
    <div
      aria-hidden
      className="glass-media absolute bottom-8 left-1/2 z-10 hidden h-8 md:flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-white/10 pl-2.5 pr-3.5 text-2xs font-medium text-fg inset-shadow-edge"
    >
      {tone === "done" ? (
        <Check size={12} weight="bold" className="text-accent-text" />
      ) : (
        <span
          className={`size-1.5 rounded-full ${tone === "error" ? "bg-danger" : "bg-accent motion-safe:animate-pulse"}`}
        />
      )}
      <span key={status} className="transition-opacity duration-150 starting:opacity-0">
        {label}
      </span>
    </div>
  );
}

/** Left side: Iris on the stage, over a dot grid that fades out in a circle. Iris's own brackets are the frame. */
function CreaturePanel(props: {
  field: Field;
  peek: boolean;
  mood: Mood;
  status: AuthStatus;
  emailRef: RefObject<HTMLInputElement | null>;
  radarRef: RefObject<HTMLDivElement | null>;
  /** The full page has room for a larger Iris from lg up; the modal's stage doesn't. */
  wide?: boolean;
  className?: string;
}) {
  return (
    <div className={`auth-stage relative isolate flex flex-col items-center justify-center bg-stage p-4 md:p-10 ${props.className ?? ""}`}>
      <div className={`relative z-[1] w-32 md:w-full md:max-w-[18rem] ${props.wide ? "lg:max-w-[20rem]" : ""}`}>
        <Creature
          field={props.field}
          peek={props.peek}
          mood={props.mood}
          emailRef={props.emailRef}
          watch={props.status === "waiting" ? props.radarRef : null}
          live={LIVE.has(props.status)}
        />
      </div>
      {/* Hidden on phones (short band): the form's status line carries the same information. */}
      <StatusBadge status={props.status} />
    </div>
  );
}

/**
 * Sign-in as a 50/50 page (direct load or refresh of /sign-in) or as a modal over the studio (in-app
 * navigation, intercepted by app/(studio)/@modal/(.)sign-in). Same form, stage and creature in both.
 */
export function AuthExperience({ variant }: { variant: "page" | "modal" }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const radarRef = useRef<HTMLDivElement>(null);
  const [field, setField] = useState<Field>(null);
  const [peek, setPeek] = useState(false);
  const [mood, setMood] = useState<Mood>({ kind: "idle", at: 0 });
  const [status, setStatus] = useState<AuthStatus>("idle");
  const signals = { onField: setField, onPeek: setPeek, onMood: setMood, onStatus: setStatus };

  // Modal: closing (X, Esc, backdrop, success) goes back in history, which unmounts the intercepted route.
  const onDone = useCallback(() => (variant === "modal" ? dialog.current?.close() : router.replace("/")), [variant, router]);

  useEffect(() => {
    if (variant !== "modal") return;
    const d = dialog.current!;
    if (!d.open) d.showModal();
    const onClose = () => window.location.pathname === "/sign-in" && router.back(); // not twice if a route change closed it
    d.addEventListener("close", onClose);
    return () => d.removeEventListener("close", onClose);
  }, [variant, router]);

  const stage = { field, peek, mood, status, emailRef, radarRef };
  const panel = { onDone, emailRef, radarRef, signals };

  if (variant === "page") {
    return (
      <div className="grid min-h-[100dvh] grid-rows-[auto_1fr] md:grid-cols-2 md:grid-rows-none">
        <div className="relative flex flex-col pt-16 md:min-h-[100dvh] md:pt-0">
          <Link
            href="/"
            className="absolute left-6 top-6 z-20 flex h-9 items-center gap-2 rounded-full border border-line bg-bg/60 px-3.5 text-ui font-medium text-fg-muted inset-shadow-edge transition hover:border-line-strong hover:text-fg active:scale-[0.98] md:left-8 md:top-8"
          >
            <ArrowLeft size={14} weight="bold" aria-hidden /> Back to studio
          </Link>
          {/* One instance at every width: a short band on phones, the full half from md up. */}
          <CreaturePanel {...stage} wide className="h-44 md:h-auto md:flex-1" />
          {/* Same bottom edge and height as the status pill, so the two read as one row. */}
          <span className="absolute bottom-8 left-8 z-20 hidden h-8 items-center gap-2 text-[15px] font-semibold tracking-tight text-fg md:flex">
            <Logo /> Intent Studio
          </span>
        </div>
        <main className="flex items-start justify-center border-line bg-bg px-6 py-8 md:items-center md:border-l md:px-12 md:py-12 lg:px-16">
          <AuthPanel heading="h1" {...panel} />
        </main>
      </div>
    );
  }

  return (
    <dialog
      ref={dialog}
      aria-label="Sign in"
      onClick={(e) => e.target === e.currentTarget && dialog.current?.close()}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(56rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-line bg-bg p-0 text-fg shadow-float backdrop:bg-[oklch(0.08_0.01_260/0.6)] opacity-0 open:opacity-100 starting:open:opacity-0 motion-safe:scale-[0.98] motion-safe:open:scale-100 motion-safe:starting:open:scale-[0.98] transition-[opacity,scale,overlay,display] transition-discrete duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]"
    >
      <div className="grid md:grid-cols-[44%_1fr]">
        <CreaturePanel {...stage} className="hidden min-h-[34rem] md:flex" />
        <div className="relative flex items-center justify-center px-8 py-10">
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            aria-label="Close"
            className="absolute right-3 top-3 grid size-9 place-items-center rounded-full text-fg-muted transition hover:bg-fg/[0.06] hover:text-fg active:scale-[0.98]"
          >
            <X size={16} weight="bold" />
          </button>
          <AuthPanel heading="h2" {...panel} />
        </div>
      </div>
    </dialog>
  );
}
