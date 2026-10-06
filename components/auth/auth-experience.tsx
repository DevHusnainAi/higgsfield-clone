"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, X } from "@phosphor-icons/react";
import { Logo } from "@/components/logo";
import { AuthPanel } from "./auth-panel";
import { Creature, type Field, type Mood } from "./creature";

/** Left side: Iris on the stage tier, framed by viewfinder corners (the logo's frame, at panel scale).
    One instance at every width: a short band above the form on phones, the full half from md up. */
function CreaturePanel(props: { field: Field; peek: boolean; mood: Mood; emailRef: React.RefObject<HTMLInputElement | null>; className?: string }) {
  const corner = "pointer-events-none absolute size-5 border-line-strong";
  return (
    <div className={`relative flex flex-col items-center justify-center gap-4 bg-stage p-4 md:p-10 ${props.className ?? ""}`}>
      <span aria-hidden className={`${corner} left-4 top-4 rounded-tl-md border-l border-t`} />
      <span aria-hidden className={`${corner} right-4 top-4 rounded-tr-md border-r border-t`} />
      <span aria-hidden className={`${corner} bottom-4 left-4 rounded-bl-md border-b border-l`} />
      <span aria-hidden className={`${corner} bottom-4 right-4 rounded-br-md border-b border-r`} />
      <div className="w-32 md:w-full md:max-w-[18rem]">
        <Creature field={props.field} peek={props.peek} mood={props.mood} emailRef={props.emailRef} />
      </div>
      <p className="hidden text-2xs text-fg-muted md:block">Iris won&rsquo;t peek at your code.</p>
    </div>
  );
}

/**
 * Sign-in as a 50/50 page (direct load or refresh of /sign-in) or as a modal over the studio (in-app
 * navigation, intercepted by app/(studio)/@modal/(.)sign-in). Same form and creature in both.
 */
export function AuthExperience({ variant }: { variant: "page" | "modal" }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const [field, setField] = useState<Field>(null);
  const [peek, setPeek] = useState(false);
  const [mood, setMood] = useState<Mood>({ kind: "idle", at: 0 });
  const signals = { onField: setField, onPeek: setPeek, onMood: setMood };

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

  const creature = { field, peek, mood, emailRef };

  if (variant === "page") {
    return (
      <div className="grid min-h-[100dvh] grid-rows-[auto_1fr] md:grid-cols-2 md:grid-rows-none">
        <div className="relative flex flex-col pt-16 md:min-h-[100dvh] md:pt-0">
          <Link
            href="/"
            className="absolute left-6 top-6 z-10 flex h-9 items-center gap-2 rounded-full border border-line px-3.5 text-ui font-medium text-fg-muted inset-shadow-edge transition hover:border-line-strong hover:text-fg active:scale-[0.98] md:left-8 md:top-8"
          >
            <ArrowLeft size={14} weight="bold" aria-hidden /> Back to Studio
          </Link>
          <CreaturePanel {...creature} className="h-44 md:h-auto md:flex-1" />
          <span className="absolute bottom-8 left-8 hidden items-center gap-2 text-[15px] font-semibold tracking-tight text-fg md:flex">
            <Logo /> Intent Studio
          </span>
        </div>
        <main className="flex items-start justify-center border-line bg-bg px-4 py-8 md:items-center md:border-l md:py-10">
          <AuthPanel heading="h1" onDone={onDone} emailRef={emailRef} signals={signals} />
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
        <CreaturePanel {...creature} className="hidden md:flex" />
        <div className="relative flex items-center justify-center px-6 py-12 md:px-10">
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            aria-label="Close"
            className="absolute right-3 top-3 grid size-9 place-items-center rounded-full text-fg-muted transition hover:bg-fg/[0.06] hover:text-fg active:scale-[0.98]"
          >
            <X size={16} weight="bold" />
          </button>
          <AuthPanel heading="h2" onDone={onDone} emailRef={emailRef} signals={signals} />
        </div>
      </div>
    </dialog>
  );
}
