// Reduce motion: the system setting (prefers-reduced-motion), or the studio's own switch in Settings, which
// can only ever reduce. The switch is a per-device display preference, so it lives in localStorage and is
// applied to <html data-motion="reduce"> before first paint (MOTION_SCRIPT in app/layout.tsx).
// globals.css and the motion-safe / motion-reduce variants treat that attribute exactly like the system setting.

const KEY = "studio.motion.v1";

/** Inline, before paint: no frame of motion before the preference applies. */
export const MOTION_SCRIPT = `try{localStorage.getItem("${KEY}")==="reduce"&&(document.documentElement.dataset.motion="reduce")}catch(e){}`;

export const systemReducesMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
export const studioReducesMotion = () => document.documentElement.dataset.motion === "reduce";

/** True when anything (system or studio switch) asks for reduced motion. For JS-driven motion. */
export const reducedMotion = () => studioReducesMotion() || systemReducesMotion();

const listeners = new Set<() => void>();

export function setStudioReduceMotion(reduce: boolean) {
  if (reduce) document.documentElement.dataset.motion = "reduce";
  else delete document.documentElement.dataset.motion;
  try {
    if (reduce) localStorage.setItem(KEY, "reduce");
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the switch still applies to this page view.
  }
  listeners.forEach((l) => l());
}

/** For useSyncExternalStore: fires on the system setting changing and on the studio switch. */
export function subscribeMotion(cb: () => void) {
  const mq = matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  listeners.add(cb);
  return () => {
    mq.removeEventListener("change", cb);
    listeners.delete(cb);
  };
}
