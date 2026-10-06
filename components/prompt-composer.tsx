import { ArrowUp } from "@phosphor-icons/react/dist/ssr";

// ponytail: shell only; submit, parameter auto-expansion and cost preview wire in next phase
export function PromptComposer() {
  return (
    <form className="w-full rounded-xl border border-line bg-surface-raised p-2 shadow-[0_8px_30px_-12px_oklch(0.2_0.01_260/0.25)] focus-within:border-fg-muted">
      <label htmlFor="prompt" className="sr-only">
        Describe what you want to make
      </label>
      <textarea
        id="prompt"
        name="prompt"
        rows={2}
        placeholder="A slow dolly-in on a rain-soaked neon street, 35mm, night"
        className="block max-h-64 min-h-14 w-full resize-none bg-transparent px-3 py-2.5 text-base leading-relaxed text-fg outline-none [field-sizing:content] placeholder:text-fg-muted"
      />
      <div className="flex items-center justify-end px-1 pt-1">
        <button
          type="submit"
          aria-label="Generate"
          className="grid size-9 place-items-center rounded-full bg-accent text-accent-ink transition hover:brightness-105 active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <ArrowUp size={18} weight="bold" />
        </button>
      </div>
    </form>
  );
}
