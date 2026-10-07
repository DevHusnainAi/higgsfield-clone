"use client";

import { useEffect, useId, useRef, type RefObject } from "react";
import { SPARK } from "@/components/logo";
import { approach, gaze, PAW_SPRING, springStep, type Spring, type Vec } from "@/lib/gaze";

export type Field = "email" | "code" | null;
export type Mood = { kind: "idle" | "happy" | "error"; at: number };

// Geometry (viewBox 240×240). Eyes sit on the body; paws rest PAW_DROP units below, outside the viewBox.
const EYES = [{ x: 95, y: 122 }, { x: 145, y: 122 }] as const;
const EYE_R = 22;
const PUPIL_TRAVEL = 9;
const PAW_DROP = 150;
const BODY = { x: 120, y: 125 };
const GROUND = { x: 120, y: 209 }; // the shadow's centre, just under the body
const PUPIL = { watch: 1.15, error: 0.8 }; // pupil scale: wide while watching the radar, narrow just after an error
const ERROR_PUPIL_MS = 1200;

// Response rates (per second) for frame-rate independent smoothing; see lib/gaze.ts.
const RATE = { pupil: 14, head: 8, home: 4, lid: 40 };
const SHAKE = [0, -6, 6, -4, 4, 0];
const SHAKE_MS = 360;

const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

const POINTER_HOLD_MS = 1500; // while waiting, a moving pointer wins the gaze for this long
const q = (n: number) => Math.round(n * 100) / 100; // stable transform strings: no sub-pixel shimmer

let measureCtx: CanvasRenderingContext2D | null = null;
/**
 * The caret's x offset inside an input, in px. Measured on input/selection events only (one shared canvas),
 * never per frame: per-frame text measurement was the main source of reading-mode jitter.
 */
function caretOffset(input: HTMLInputElement): number {
  measureCtx ??= document.createElement("canvas").getContext("2d")!;
  const cs = getComputedStyle(input);
  measureCtx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const before = input.value.slice(0, input.selectionStart ?? input.value.length);
  const pad = parseFloat(cs.paddingLeft);
  return Math.min(pad + measureCtx.measureText(before).width - input.scrollLeft, input.clientWidth - parseFloat(cs.paddingRight));
}

/**
 * Iris, the sign-in creature. Decorative (aria-hidden): every state it shows is also stated in the form.
 * Tracks the pointer, reads along the email field, watches the radar while waiting for the email link,
 * covers its eyes while the code field has focus, peeks when the code is shown, hops on success, shakes
 * on error. All motion stops under reduced motion.
 */
export function Creature({
  field,
  peek,
  mood,
  emailRef,
  watch,
  live = false,
}: {
  field: Field;
  peek: boolean;
  mood: Mood;
  emailRef: RefObject<HTMLInputElement | null>;
  /** Something is in flight (Google opening, sending, waiting): the forehead spark pulses. */
  live?: boolean;
  /** While set, Iris watches this element (the radar) unless the pointer moved in the last 1.5s. */
  watch: RefObject<HTMLElement | null> | null;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const clip = `iris-eye-${useId().replace(/:/g, "")}`; // unique per instance: url(#…) resolves to the first match
  const input = useRef({ field, peek, mood, watch }); // latest props, read by the frame loop
  const wake = useRef<() => void>(() => {});

  useEffect(() => {
    input.current = { field, peek, mood, watch };
    wake.current();
  }, [field, peek, mood, watch]);

  useEffect(() => {
    const el = svg.current!;
    // The animated groups, by data-part: written straight to the DOM each frame, no React renders.
    const p = Object.fromEntries([...el.querySelectorAll<SVGGElement>("[data-part]")].map((n) => [n.dataset.part!, n]));
    let pointer: Vec | null = null;
    let movedAt = -Infinity;
    let holdTimer: ReturnType<typeof setTimeout> | undefined;
    let caretX = 0; // px from the email field's left edge; refreshed on input/selection events
    let frame = 0;
    let last = 0;
    const pupils = EYES.map(() => ({ x: 0, y: 0 }));
    const head = { x: 0, y: 0, r: 0 };
    let pupilScale = 1;
    const lids = [0, 0];
    const paws: Spring[] = [{ x: 1, v: 0 }, { x: 1, v: 0 }]; // 1 = resting below, 0 = over the eyes
    let hop: Spring = { x: 0, v: 0 };
    let blinkUntil = 0;
    let nextBlink = performance.now() + 2500 + Math.random() * 3500;
    let moodSeen = input.current.mood.at;
    let shakeStart = -Infinity;

    const set = (k: string, t: string) => p[k]?.setAttribute("transform", t);
    const centre = (r: DOMRect): Vec => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

    const tick = (now: number) => {
      const dt = Math.min(0.1, last ? (now - last) / 1000 : 1 / 60);
      last = now;
      const reduce = reduceMotion();
      const { field, peek, mood, watch } = input.current;
      const cover = field === "code";
      const watching = !!watch?.current && now - movedAt > POINTER_HOLD_MS;
      el.dataset.state = cover ? (peek ? "peek" : "cover") : field === "email" ? "read" : watching ? "watch" : "track";

      // Reactions to a new mood (success hop / error shake), once per mood change.
      if (mood.at !== moodSeen) {
        moodSeen = mood.at;
        if (!reduce && mood.kind === "happy") hop = { x: 0, v: -170 };
        if (!reduce && mood.kind === "error") shakeStart = now;
      }

      // Gaze target: the caret while typing the email, the radar while waiting, else the pointer, else ahead.
      // All layout reads happen here, before any writes below, so a frame never forces a second layout.
      const box = el.getBoundingClientRect();
      const scale = box.width / 240;
      const toClient = (v: Vec) => ({ x: box.left + v.x * scale, y: box.top + v.y * scale });
      let target: Vec | null = null;
      if (!reduce) {
        const emailBox = field === "email" ? emailRef.current?.getBoundingClientRect() : undefined;
        if (emailBox) target = { x: emailBox.left + caretX, y: emailBox.top + emailBox.height / 2 };
        else if (watching) target = centre(watch!.current!.getBoundingClientRect());
        else target = pointer;
      }
      const rate = target ? RATE.pupil : RATE.home;
      const pupilTo = reduce ? 1 : mood.kind === "error" && now - mood.at < ERROR_PUPIL_MS ? PUPIL.error : watching && !cover ? PUPIL.watch : 1;

      let busy = false;
      const ease = (cur: number, to: number, r: number) => {
        const next = approach(cur, to, r, dt);
        if (Math.abs(next - to) > 0.05) busy = true;
        return Math.abs(next - to) > 0.01 ? next : to;
      };

      pupilScale = reduce ? pupilTo : ease(pupilScale, pupilTo, RATE.head);
      if (mood.kind === "error" && now - mood.at < ERROR_PUPIL_MS) busy = true; // wake again to widen back
      EYES.forEach((eye, i) => {
        const g = target ? gaze(target, toClient(eye), PUPIL_TRAVEL, 300 * scale) : { x: 0, y: 0 };
        pupils[i].x = ease(pupils[i].x, g.x, rate);
        pupils[i].y = ease(pupils[i].y, g.y, rate);
        const s = q(pupilScale);
        set(`pupil${i}`, `translate(${q(pupils[i].x + eye.x)} ${q(pupils[i].y + eye.y)}) scale(${s}) translate(${-eye.x} ${-eye.y})`);
      });

      // Head and brackets lean toward the target; nearer parts move more (depth).
      const lean = target ? gaze(target, toClient(BODY), 6, 400 * scale) : { x: 0, y: 0 };
      head.x = ease(head.x, lean.x, target ? RATE.head : RATE.home);
      head.y = ease(head.y, lean.y, target ? RATE.head : RATE.home);
      head.r = ease(head.r, (lean.x / 6) * 3, target ? RATE.head : RATE.home);

      // Paws: a real spring up over the eyes and back down. Reduced motion snaps (CSS crossfades opacity).
      const pawTo = [cover ? 0 : 1, cover ? (peek ? 0.4 : 0) : 1];
      paws.forEach((s, i) => {
        paws[i] = reduce ? { x: pawTo[i], v: 0 } : springStep(s, pawTo[i], PAW_SPRING.stiffness, PAW_SPRING.damping, dt);
        if (Math.abs(paws[i].x - pawTo[i]) > 0.002 || Math.abs(paws[i].v) > 0.01) busy = true;
        set(`paw${i}`, `translate(0 ${q(paws[i].x * PAW_DROP)})`);
      });
      el.dataset.covered = String(cover);

      // Lids: closed while covered (the peeking eye half open), blinking when idle, half-lowered when happy.
      if (!reduce && !cover && now > nextBlink) {
        blinkUntil = now + 140;
        nextBlink = now + 2500 + Math.random() * 3500;
      }
      const blinking = now < blinkUntil;
      if (blinking) busy = true;
      const happy = mood.kind === "happy" && now - mood.at < 2400;
      const lidTo = [cover ? 1 : blinking ? 1 : happy ? 0.45 : 0, cover ? (peek ? 0.5 : 1) : blinking ? 1 : happy ? 0.45 : 0];
      lids.forEach((v, i) => {
        lids[i] = reduce ? lidTo[i] : ease(v, lidTo[i], RATE.lid);
        const top = EYES[i].y - EYE_R;
        set(`lid${i}`, `translate(0 ${top}) scale(1 ${q(lids[i])}) translate(0 ${-top})`);
      });
      if (happy) busy = true;

      // One-shot reactions: hop (spring) and shake (keyframes).
      hop = springStep(hop, 0, PAW_SPRING.stiffness, PAW_SPRING.damping, dt);
      if (Math.abs(hop.x) > 0.05 || Math.abs(hop.v) > 0.5) busy = true;
      const t = (now - shakeStart) / SHAKE_MS;
      let shake = 0;
      if (t >= 0 && t < 1) {
        const f = t * (SHAKE.length - 1);
        const k = Math.floor(f);
        shake = SHAKE[k] + (SHAKE[k + 1] - SHAKE[k]) * (f - k);
        busy = true;
      }
      set("head", `translate(${q(head.x + shake)} ${q(head.y + hop.x)}) rotate(${q(head.r)} ${BODY.x} ${BODY.y})`);
      set("frame", `translate(${q(head.x / 3)} ${q(head.y / 3)})`);
      // Edge light stays put while the head tilts, so it slides along the top edge. The ground shadow
      // tightens and fades as Iris leaves the floor on a hop (hop.x is negative going up).
      set("rim", `translate(${q(-head.r * 4)} 0)`);
      const lift = Math.min(1, Math.max(0, -hop.x / 40));
      set("shadow", `translate(${GROUND.x} ${GROUND.y}) scale(${q(1 - lift * 0.35)}) translate(${-GROUND.x} ${-GROUND.y})`);
      p.shadow?.setAttribute("opacity", String(q(1 - lift * 0.5)));
      // The CSS idle float pauses while Iris covers its eyes or hops, so the two never stack.
      if (cover || Math.abs(hop.x) > 0.5) el.dataset.still = "";
      else delete el.dataset.still;

      // Asleep once settled; woken by pointer moves, caret moves, prop changes and the blink heartbeat.
      frame = busy ? requestAnimationFrame(tick) : 0;
      if (!frame) last = 0;
    };

    wake.current = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" && e.pointerType !== "pen") return; // touch: focus-driven only
      pointer = { x: e.clientX, y: e.clientY };
      movedAt = performance.now();
      wake.current();
      // The loop may be asleep when the pointer hold ends: wake it exactly then, not on the next heartbeat.
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => wake.current(), POINTER_HOLD_MS + 20);
    };
    const onLeave = () => {
      pointer = null;
      wake.current();
    };
    const onCaret = () => {
      if (input.current.field !== "email" || !emailRef.current) return;
      caretX = caretOffset(emailRef.current);
      wake.current();
    };
    // Blinks need a heartbeat even when nothing moves.
    const blinker = setInterval(() => wake.current(), 1000);

    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);
    document.addEventListener("selectionchange", onCaret);
    document.addEventListener("input", onCaret, true);
    document.addEventListener("focusin", onCaret);
    wake.current();
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(blinker);
      clearTimeout(holdTimer);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
      document.removeEventListener("selectionchange", onCaret);
      document.removeEventListener("input", onCaret, true);
      document.removeEventListener("focusin", onCaret);
    };
  }, [emailRef]);

  return (
    <svg ref={svg} viewBox="0 0 240 240" aria-hidden className="w-full overflow-hidden" data-state="track">
      <defs>
        <radialGradient id={`${clip}-shadow`}>
          <stop offset="0" stopColor="oklch(0 0 0)" stopOpacity="0.55" />
          <stop offset="1" stopColor="oklch(0 0 0)" stopOpacity="0" />
        </radialGradient>
        {EYES.map((e, i) => (
          <clipPath key={i} id={`${clip}-${i}`}>
            <circle cx={e.x} cy={e.y} r={EYE_R} />
          </clipPath>
        ))}
      </defs>

      {/* Viewfinder brackets: the logo's frame, drifting slightly behind the head for depth. */}
      <g data-part="frame" className="fill-none stroke-fg-muted" strokeWidth="2.5" strokeLinecap="round">
        <path d="M24 64V50a16 16 0 0 1 16-16h14M186 34h14a16 16 0 0 1 16 16v14M216 186v14a16 16 0 0 1-16 16h-14M54 216H40a16 16 0 0 1-16-16v-14" />
      </g>

      {/* Ground shadow: stays on the floor while the body floats above it. */}
      <g className="iris-shadow">
        <g data-part="shadow">
          <ellipse cx={GROUND.x} cy={GROUND.y} rx="64" ry="7" fill={`url(#${clip}-shadow)`} />
        </g>
      </g>

      <g className="iris-float">
      <g data-part="head">
        <rect x="40" y="50" width="160" height="150" rx="44" className="fill-surface-raised stroke-line-strong" strokeWidth="1.5" />
        <g data-part="rim">
          <path d="M84 51.5H156" className="stroke-[oklch(1_0_0/0.12)]" strokeWidth="1.5" strokeLinecap="round" />
        </g>
        <path
          d={SPARK}
          transform="translate(105.6 63.6) scale(1.2)"
          className={`fill-accent transition-opacity duration-300 ${field === "code" ? "opacity-40" : ""} ${live ? "iris-spark-live" : ""}`}
        />

        {EYES.map((e, i) => (
          <g key={i} clipPath={`url(#${clip}-${i})`}>
            <circle cx={e.x} cy={e.y} r={EYE_R} className="fill-fg" />
            <g data-part={`pupil${i}`}>
              <circle cx={e.x} cy={e.y} r="9" className="fill-bg stroke-accent" strokeWidth="2" />
              <circle cx={e.x + 3} cy={e.y - 3} r="3" className="fill-fg" />
            </g>
            <g data-part={`lid${i}`}>
              <rect x={e.x - EYE_R - 1} y={e.y - EYE_R - 1} width={EYE_R * 2 + 2} height={EYE_R * 2 + 2} className="fill-surface-raised" />
            </g>
          </g>
        ))}

        {/* All three mouths are drawn; the mood cross-fades between them instead of swapping shapes. */}
        <g className="fill-none stroke-fg-muted [&>*]:transition-opacity [&>*]:duration-150" strokeWidth="2.5" strokeLinecap="round">
          <path d="M110 164 H130" className={mood.kind === "idle" ? "" : "opacity-0"} />
          <path d="M108 160 Q120 172 132 160" className={mood.kind === "happy" ? "" : "opacity-0"} />
          <circle cx="120" cy="164" r="5" className={mood.kind === "error" ? "" : "opacity-0"} />
        </g>
      </g>

      {/* Paws rise from below the viewBox over the eyes. Under reduced motion they crossfade instead. */}
      {[63, 121].map((x, i) => (
        <g key={x} data-part={`paw${i}`} transform={`translate(0 ${PAW_DROP})`}>
          <rect
            x={x}
            y="100"
            width="56"
            height="40"
            rx="20"
            className={`fill-surface-hover stroke-line-strong motion-reduce:transition-opacity motion-reduce:duration-150 ${field === "code" ? "" : "motion-reduce:opacity-0"}`}
            strokeWidth="1.5"
          />
        </g>
      ))}
      </g>
    </svg>
  );
}
