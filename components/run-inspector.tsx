"use client";

import type { ReactNode } from "react";
import { estimateCost, type Generation } from "@/lib/generation";
import type { Intent } from "@/lib/intent";
import { MODELS } from "@/lib/models";
import { title } from "./param-chips";

const CREDIT_STATE = { held: "on hold", charged: "charged", refunded: "refunded" } as const;

/** Labels sit above values, so a long value (model name, prompt) wraps instead of squeezing its label. */
function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 ${wide ? "col-span-2" : ""}`}>
      <dt className="text-2xs text-fg-muted">{label}</dt>
      <dd className="text-ui tabular-nums text-fg [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

/** Property panel for the selected run, or for the intent still being started (`gen` absent). */
export function RunInspector({ intent, gen, outputs = 1 }: { intent: Intent; gen?: Generation; outputs?: number }) {
  const model = MODELS[intent.model];
  const cost = gen?.credits.amount ?? estimateCost(intent);
  const finished = gen && (gen.status === "done" || gen.status === "failed");

  return (
    <aside aria-label="Run details" className="flex min-w-0 flex-col gap-4 rounded-xl border border-line bg-surface-raised p-4 inset-shadow-edge">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Prompt" wide>
          <span className="text-fg-muted">{intent.prompt}</span>
        </Field>
        <Field label="Model" wide>{model.label}</Field>
        <Field label="Format">{title(intent.media)}</Field>
        <Field label="Aspect ratio">{intent.aspectRatio}</Field>
        {intent.media === "video" && (
          <>
            <Field label="Duration">{intent.durationSec}s</Field>
            <Field label="Camera">{intent.camera ? title(intent.camera) : "None"}</Field>
          </>
        )}
        <Field label="Seed">
          <span className="font-mono">{intent.seed ?? "Random"}</span>
        </Field>
        <Field label="Guidance">{model.guidance ? (intent.guidanceScale ?? `${model.guidance.default} (default)`) : "Not used"}</Field>
        {outputs > 1 && <Field label="Outputs">{outputs}</Field>}
        <Field label="Credits">
          {cost} {gen ? CREDIT_STATE[gen.credits.state] : "to hold"}
        </Field>
        {gen && <Field label="Started">{new Date(gen.createdAt).toLocaleTimeString([], { hour12: false })}</Field>}
        {finished && <Field label="Took">{((gen.updatedAt - gen.createdAt) / 1000).toFixed(1)}s</Field>}
      </dl>
    </aside>
  );
}
