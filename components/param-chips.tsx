"use client";

import type { CSSProperties, KeyboardEvent, ToggleEvent } from "react";
import { CaretDown, Check, Warning } from "@phosphor-icons/react";
import {
  ASPECT_RATIOS, CAMERA_MOVES, DURATION, parseIntent, VIDEO_RATIOS,
  type Intent, type IntentField, type IntentOverrides,
} from "@/lib/intent";

type Value = string | number | null;

export const title = (s: string) => (s === "fpv" ? "FPV drone" : s.charAt(0).toUpperCase() + s.slice(1).replace("-", " "));

const FIELD_LABEL: Record<IntentField, string> = { media: "Format", camera: "Camera", aspectRatio: "Aspect ratio", durationSec: "Duration" };

function display(field: IntentField, intent: Intent): string {
  if (field === "media") return title(intent.media);
  if (field === "camera") return intent.camera ? title(intent.camera) : "No camera move";
  if (field === "durationSec") return `${intent.durationSec}s`;
  return intent.aspectRatio;
}

function options(field: IntentField, intent: Intent): [Value, string][] {
  if (field === "media") return [["image", "Image"], ["video", "Video"]];
  if (field === "camera") return [[null, "No camera move"], ...CAMERA_MOVES.map((m): [Value, string] => [m, title(m)])];
  if (field === "durationSec") {
    return Array.from({ length: DURATION.max - DURATION.min + 1 }, (_, i): [Value, string] => [DURATION.min + i, `${DURATION.min + i}s`]);
  }
  return (intent.media === "video" ? VIDEO_RATIOS : ASPECT_RATIOS).map((r): [Value, string] => [r, r]);
}

/** Native popover anchored to its trigger (CSS anchor positioning; falls back to sitting next to it). */
export const popoverClass =
  "m-0 inset-auto mb-2 [position-area:top_span-right] [position-try-fallbacks:flip-block] rounded-xl border border-line bg-surface-raised p-1 text-fg shadow-float inset-shadow-edge";
export const anchor = (name: string) => ({ anchorName: name }) as CSSProperties;
export const anchoredTo = (name: string) => ({ positionAnchor: name }) as CSSProperties;

/** role="menu" promises arrow keys to assistive tech: Up/Down/Home/End move between items, wrapping. */
export function menuKeys(e: KeyboardEvent<HTMLElement>) {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
  const i = items.indexOf(document.activeElement as HTMLElement);
  const to = ({ ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 } as Record<string, number>)[e.key];
  if (to === undefined) return;
  e.preventDefault();
  items[(to + items.length) % items.length]?.focus();
}

/** On open, focus lands on the current choice, as a menu should. */
export const focusChecked = (e: ToggleEvent<HTMLElement>) =>
  e.newState === "open" && e.currentTarget.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();

export const closePopover = (el: HTMLElement) => (el.closest("[popover]") as HTMLElement | null)?.hidePopover();

const itemClass =
  "flex w-full items-center justify-between gap-6 rounded-lg px-2.5 py-1.5 text-left text-sm text-fg-muted transition-colors hover:bg-fg/[0.06] hover:text-fg aria-checked:text-fg";

export function ParamChips({
  intent,
  overrides,
  onOverridesChange,
}: {
  intent: Intent;
  overrides: IntentOverrides;
  onOverridesChange: (o: IntentOverrides) => void;
}) {
  if (!intent.prompt) return null;
  const fields: IntentField[] = intent.media === "video" ? ["media", "camera", "aspectRatio", "durationSec"] : ["media", "aspectRatio"];

  const choose = (field: IntentField, value: Value | undefined) => {
    const next: Record<string, unknown> = { ...overrides };
    if (value === undefined) delete next[field];
    else next[field] = value;
    onOverridesChange(next as IntentOverrides);
  };

  return (
    <div className="flex flex-col gap-2 px-2">
      <ul aria-label="Settings read from your prompt" className="flex flex-wrap gap-1.5">
        {fields.map((field) => {
          const overridden = field in overrides;
          const source = intent.matched[field];
          const auto = parseIntent(intent.prompt, { ...overrides, [field]: undefined }); // undefined = auto
          const id = `chip-${field}`;
          const caption = overridden ? "Set by you" : source ? `From "${source}"` : "Default";
          return (
            <li key={field}>
              <button
                type="button"
                popoverTarget={id}
                style={anchor(`--${id}`)}
                className={
                  overridden
                    ? "flex items-center gap-1 rounded-full border border-accent/50 bg-accent/10 py-1 pl-3 pr-2 text-xs font-medium text-fg inset-shadow-edge transition hover:border-accent active:scale-[0.98]"
                    : source
                      ? "flex items-center gap-1 rounded-full border border-line-strong bg-fg/[0.06] py-1 pl-3 pr-2 text-xs font-medium text-fg inset-shadow-edge transition hover:border-fg-muted active:scale-[0.98]"
                      : "flex items-center gap-1 rounded-full border border-dashed border-line-strong py-1 pl-3 pr-2 text-xs text-fg-muted transition hover:border-fg-muted hover:text-fg active:scale-[0.98]"
                }
              >
                {display(field, intent)}
                <CaretDown size={10} weight="bold" aria-hidden />
                <span className="sr-only">
                  , {FIELD_LABEL[field]}, {caption}
                </span>
              </button>
              <div id={id} popover="auto" role="menu" aria-label={FIELD_LABEL[field]} style={anchoredTo(`--${id}`)} onKeyDown={menuKeys} onToggle={focusChecked} className={`${popoverClass} w-52`}>
                <p className="px-2.5 pb-1 pt-1.5 text-xs text-fg-muted">
                  {FIELD_LABEL[field]}: {caption}
                </p>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={!overridden}
                  onClick={(e) => (choose(field, undefined), closePopover(e.currentTarget))}
                  className={itemClass}
                >
                  <span>
                    Auto <span className="text-fg-muted">({display(field, auto)})</span>
                  </span>
                  {!overridden && <Check size={14} />}
                </button>
                <div className="my-1 h-px bg-line" />
                <div className="max-h-64 overflow-y-auto">
                  {options(field, intent).map(([value, label]) => {
                    const checked = overridden && intent[field] === value;
                    return (
                      <button
                        key={String(value)}
                        type="button"
                        role="menuitemradio"
                        aria-checked={checked}
                        onClick={(e) => (choose(field, value), closePopover(e.currentTarget))}
                        className={itemClass}
                      >
                        {label}
                        {checked && <Check size={14} />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {intent.warnings.map((w) => (
        <p key={w.message} className="flex items-start gap-1.5 text-xs leading-relaxed text-fg-muted">
          <Warning size={14} className="mt-px shrink-0 text-accent-text" />
          {w.message}
        </p>
      ))}
    </div>
  );
}
