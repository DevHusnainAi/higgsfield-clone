"use client";

import { DiceFive, SlidersHorizontal } from "@phosphor-icons/react";
import { COUNT, type Intent, type IntentOverrides } from "@/lib/intent";
import { DEFAULT_MODEL, MAX_SEED, MODELS, modelsFor, type ModelId } from "@/lib/models";
import { anchor, anchoredTo, popoverClass } from "./param-chips";

const ADVANCED_KEYS = ["count", "model", "seed", "guidanceScale"] as const;
const COUNTS = Array.from({ length: COUNT.max - COUNT.min + 1 }, (_, i) => COUNT.min + i);

const inputClass =
  "h-9 w-full rounded-lg border border-line-strong bg-bg px-2.5 text-sm text-fg outline-none transition focus:border-fg-muted";

export function AdvancedSettings({
  intent,
  overrides,
  onOverridesChange,
}: {
  intent: Intent;
  overrides: IntentOverrides;
  onOverridesChange: (o: IntentOverrides) => void;
}) {
  const active = ADVANCED_KEYS.filter((k) => k in overrides).length;
  const model = MODELS[intent.model];
  const range = model.guidance;

  const set = (patch: IntentOverrides, clear: (keyof IntentOverrides)[] = []) => {
    const next: Record<string, unknown> = { ...overrides, ...patch };
    for (const k of clear) delete next[k];
    onOverridesChange(next as IntentOverrides);
  };
  const reset = () => set({}, [...ADVANCED_KEYS]);

  return (
    <>
      <button
        type="button"
        popoverTarget="advanced-settings"
        style={anchor("--advanced")}
        aria-label={active ? `Advanced settings, ${active} set` : "Advanced settings"}
        className="relative grid size-9 shrink-0 place-items-center rounded-full border border-line text-fg-muted inset-shadow-edge transition hover:border-line-strong hover:text-fg active:scale-[0.96]"
      >
        <SlidersHorizontal size={16} />
        {active > 0 && (
          <span aria-hidden className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-accent text-[10px] font-semibold tabular-nums text-accent-ink">
            {active}
          </span>
        )}
      </button>

      <div
        id="advanced-settings"
        popover="auto"
        aria-label="Advanced settings"
        style={anchoredTo("--advanced")}
        className={`${popoverClass} w-[min(20rem,calc(100vw-2rem))] p-4`}
      >
        <div className="flex items-center justify-between pb-3">
          <h3 className="text-sm font-semibold">Advanced</h3>
          <button type="button" onClick={reset} disabled={!active} className="text-xs text-fg-muted transition hover:text-fg disabled:opacity-40">
            Reset all
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-1.5">
            <legend className="pb-1.5 text-xs font-medium text-fg-muted">Output count</legend>
            <div className="grid grid-cols-4 gap-1 rounded-lg border border-line-strong p-0.5">
              {COUNTS.map((n) => (
                <label
                  key={n}
                  className="grid h-8 cursor-pointer place-items-center rounded-md text-sm tabular-nums text-fg-muted transition hover:text-fg has-checked:bg-fg/10 has-checked:text-fg has-focus-visible:outline-2 has-focus-visible:outline-accent"
                >
                  <input
                    type="radio"
                    name="adv-count"
                    value={n}
                    checked={intent.count === n}
                    onChange={() => (n === COUNT.min ? set({}, ["count"]) : set({ count: n }))}
                    className="sr-only"
                  />
                  {n}
                </label>
              ))}
            </div>
            <p className="text-xs text-fg-muted">Each output is a separate render, charged only if it finishes.</p>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="adv-model" className="text-xs font-medium text-fg-muted">
              Model
            </label>
            <select
              id="adv-model"
              value={intent.model}
              onChange={(e) => {
                const id = e.target.value as ModelId;
                if (id === DEFAULT_MODEL[intent.media]) set({}, ["model"]);
                else set({ model: id });
              }}
              className={inputClass}
            >
              {modelsFor(intent.media).map(([id, m]) => (
                <option key={id} value={id}>
                  {m.label} · {m.credits} credits{intent.media === "video" ? "/s" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="adv-seed" className="text-xs font-medium text-fg-muted">
              Seed
            </label>
            <div className="flex gap-2">
              <input
                id="adv-seed"
                type="number"
                inputMode="numeric"
                min={0}
                max={MAX_SEED}
                step={1}
                placeholder="Random"
                value={intent.seed ?? ""}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (e.target.value === "") set({}, ["seed"]);
                  else if (Number.isInteger(n) && n >= 0 && n <= MAX_SEED) set({ seed: n });
                }}
                className={`${inputClass} tabular-nums`}
              />
              <button
                type="button"
                onClick={() => set({ seed: Math.floor(Math.random() * MAX_SEED) })}
                aria-label="Pick a random seed"
                className="grid size-9 shrink-0 place-items-center rounded-lg border border-line-strong text-fg-muted transition hover:text-fg active:scale-[0.96]"
              >
                <DiceFive size={16} />
              </button>
            </div>
            <p className="text-xs text-fg-muted">Same seed + same settings = the same result.{intent.count > 1 && " Each extra output uses the next seed."}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="adv-guidance" className="text-xs font-medium text-fg-muted">
                Guidance scale
              </label>
              {range && (
                <span className="font-mono text-xs tabular-nums text-fg">
                  {intent.guidanceScale ?? range.default}
                  {intent.guidanceScale == null && <span className="text-fg-muted"> default</span>}
                </span>
              )}
            </div>
            {range ? (
              <>
                <input
                  id="adv-guidance"
                  type="range"
                  min={range.min}
                  max={range.max}
                  step={0.5}
                  value={intent.guidanceScale ?? range.default}
                  onChange={(e) => set({ guidanceScale: Number(e.target.value) })}
                  className="w-full accent-[var(--accent)]"
                />
                <p className="text-xs text-fg-muted">Higher follows the prompt more literally; lower gives the model more freedom.</p>
              </>
            ) : (
              <p id="adv-guidance" className="text-xs text-fg-muted">
                {model.label} is distilled and has no guidance setting.
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
