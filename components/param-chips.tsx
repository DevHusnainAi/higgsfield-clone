import { Warning } from "@phosphor-icons/react";
import type { Intent, IntentField } from "@/lib/intent";

const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace("-", " ");

function chips(intent: Intent): { field: IntentField; value: string }[] {
  return [
    { field: "media", value: label(intent.media) },
    ...(intent.camera ? [{ field: "camera" as const, value: label(intent.camera) }] : []),
    { field: "aspectRatio", value: intent.aspectRatio },
    ...(intent.durationSec ? [{ field: "durationSec" as const, value: `${intent.durationSec}s` }] : []),
  ];
}

// ponytail: read-only; chip editing comes when users need to override the parser
export function ParamChips({ intent }: { intent: Intent }) {
  if (!intent.prompt) return null;
  return (
    <div className="flex flex-col gap-2 px-2">
      <ul aria-label="Settings read from your prompt" className="flex flex-wrap gap-1.5">
        {chips(intent).map(({ field, value }) => {
          const source = intent.matched[field];
          return (
            <li
              key={field}
              title={source ? `From "${source}"` : "Default"}
              className={
                source
                  ? "rounded-full border border-line-strong bg-fg/[0.06] px-3 py-1 text-xs font-medium text-fg inset-shadow-edge"
                  : "rounded-full border border-dashed border-line-strong px-3 py-1 text-xs text-fg-muted"
              }
            >
              {value}
              {source ? <span className="sr-only">, from &quot;{source}&quot;</span> : <span className="sr-only">, default</span>}
            </li>
          );
        })}
      </ul>
      {intent.warnings.map((w) => (
        <p key={w} className="flex items-start gap-1.5 text-xs leading-relaxed text-fg-muted">
          <Warning size={14} className="mt-px shrink-0 text-accent-text" />
          {w}
        </p>
      ))}
    </div>
  );
}
