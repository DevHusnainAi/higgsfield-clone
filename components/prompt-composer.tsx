"use client";

import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { ArrowUp } from "@phosphor-icons/react";
import { cheaperAlternatives, costBreakdown, estimateCost } from "@/lib/generation";
import { parseIntent, type AspectRatio, type IntentOverrides } from "@/lib/intent";
import { remoteEnabled, uploadReference } from "@/lib/remote";
import { startGeneration, useStudio } from "@/lib/store";
import { AdvancedSettings } from "./advanced-settings";
import { ParamChips } from "./param-chips";
import { nearestVideoRatio, ReferenceLibrary, ReferencePreview } from "./reference-picker";

export function PromptComposer({
  prompt,
  onPromptChange,
  overrides,
  onOverridesChange,
}: {
  prompt: string;
  onPromptChange: (p: string) => void;
  overrides: IntentOverrides;
  onOverridesChange: Dispatch<SetStateAction<IntentOverrides>>;
}) {
  const intent = useMemo(() => parseIntent(prompt, overrides), [prompt, overrides]);
  const cost = estimateCost(intent);
  const empty = !intent.prompt;
  const { balance } = useStudio();
  const short = !empty && balance !== null && cost > balance;
  const alternatives = short ? cheaperAlternatives(intent, balance) : [];
  const [local, setLocal] = useState<string | null>(null); // preview of the attached frame: an object URL after upload, or a library link
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  function dropLocal() {
    if (local?.startsWith("blob:")) URL.revokeObjectURL(local);
    setLocal(null);
  }

  async function attach(file: File) {
    dropLocal();
    setUploadError(null);
    setLocal(URL.createObjectURL(file));
    setUploading(true);
    try {
      const [reference, { width, height }] = await Promise.all([uploadReference(file), createImageBitmap(file)]);
      const aspectRatio = nearestVideoRatio(width, height);
      onOverridesChange((o) => ({ ...o, reference, aspectRatio }));
    } catch (err) {
      dropLocal();
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  function pick(frame: { path: string; url: string }, aspectRatio: AspectRatio) {
    dropLocal();
    setUploadError(null);
    setLocal(frame.url);
    onOverridesChange((o) => ({ ...o, reference: frame.path, aspectRatio }));
  }

  function removeReference() {
    dropLocal();
    onOverridesChange((o) => {
      const next = { ...o };
      delete next.reference;
      return next;
    });
  }

  function submit() {
    if (!empty && !short && !uploading) startGeneration(intent);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      // Firefox restores form-control state (incl. a button's disabled flag) on reload, before React hydrates.
      autoComplete="off"
      className="glass flex flex-col gap-2 rounded-xl border border-line p-2 shadow-float inset-shadow-edge transition-colors focus-within:border-line-strong"
    >
      {(uploading || overrides.reference) && (
        <ReferencePreview path={overrides.reference ?? null} localUrl={local} uploading={uploading} onRemove={removeReference} />
      )}
      {uploadError && (
        <p role="alert" className="px-3 pt-1 text-xs text-danger">
          {uploadError}
        </p>
      )}
      <label htmlFor="prompt" className="sr-only">
        Describe what you want to make
      </label>
      <textarea
        id="prompt"
        name="prompt"
        rows={2}
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="A slow dolly-in on a rain-soaked neon street, 35mm, night"
        className="block max-h-56 min-h-14 w-full resize-none bg-transparent px-3 py-2.5 text-base leading-relaxed text-fg outline-none [field-sizing:content] placeholder:text-fg-muted"
      />
      <ParamChips intent={intent} overrides={overrides} onOverridesChange={onOverridesChange} />
      <div className="flex items-center gap-3 pl-1 pr-1">
        <AdvancedSettings intent={intent} overrides={overrides} onOverridesChange={onOverridesChange} />
        {remoteEnabled && (
          <ReferenceLibrary
            attached={overrides.reference ?? null}
            uploading={uploading}
            onUpload={(f) => void attach(f)}
            onPick={pick}
            onDeleted={(path) => path === overrides.reference && removeReference()}
          />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-muted" aria-live="polite">
          {empty ? "Shift + Enter for a new line" : `${costBreakdown(intent)} = ${cost}`}
        </span>
        <button
          type="submit"
          disabled={empty || short || uploading}
          className="flex h-9 shrink-0 items-center gap-2 rounded-full bg-accent pl-4 pr-3 text-sm font-medium text-accent-ink transition hover:brightness-105 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          {empty ? "Generate" : short ? `Need ${cost}, have ${balance}` : `Generate · ${cost} credits`}
          <ArrowUp size={16} weight="bold" />
        </button>
      </div>

      {short && (
        <div role="status" className="flex flex-wrap items-center gap-2 border-t border-line px-2 pb-1 pt-2.5 text-xs text-fg-muted">
          {alternatives.length ? <span>Not enough credits. Instead:</span> : <span>Nothing fits your {balance} credits yet.</span>}
          {alternatives.map((alt) => (
            <button
              key={alt.label}
              type="button"
              onClick={() => {
                const next = { ...overrides, ...alt.overrides };
                onOverridesChange(next);
                startGeneration(parseIntent(prompt, next));
              }}
              className="rounded-full border border-line-strong px-3 py-1 font-medium text-fg inset-shadow-edge transition hover:border-accent hover:bg-accent/10 active:scale-[0.97]"
            >
              {alt.label} · {alt.cost} credits
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
