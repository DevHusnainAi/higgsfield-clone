"use client";

import Image from "next/image";
import { ArrowsClockwise, FilmStrip } from "@phosphor-icons/react";
import { isVideo, ResultMedia } from "@/components/result-media";
import type { Generation } from "@/lib/generation";
import { parseIntent } from "@/lib/intent";
import { intentLabels } from "@/lib/labels";

// Each preset exercises a different part of the parser. Photos (Unsplash, via picsum ids) were picked to match
// each prompt and are self-hosted in public/presets at the preset's aspect ratio: no runtime CDN dependency.
const PRESETS: { id: number; prompt: string }[] = [
  { id: 1060, prompt: "Slow dolly-in on pour-over coffee brewing, vertical video, 6s" },
  { id: 1027, prompt: "Portrait photo of a woman in soft window light, 4:5" },
  { id: 1067, prompt: "Drone flyover of a city skyline at golden hour, 16:9, 5s" },
  { id: 1069, prompt: "Orange jellyfish drifting through deep blue water, slow pan left, tiktok reel" },
  { id: 1074, prompt: "Lioness staring into the lens, telephoto photo, 3:2" },
  { id: 1039, prompt: "Waterfall in a mossy gorge, tilt up, 4s clip" },
  { id: 1080, prompt: "Ripe strawberries filling the frame, overhead product shot, square format" },
  { id: 1036, prompt: "Tents pitched below snowy peaks, anamorphic still" },
  { id: 1025, prompt: "Sleepy pug wrapped in a wool blanket, cinematic portrait, 2:3" },
  { id: 1040, prompt: "Slow orbit around a fairytale castle above the forest, 16:9, 6s" },
  { id: 1084, prompt: "Walruses resting on a pale shore, documentary photo, 4:3" },
  { id: 1018, prompt: "Green valley under rolling clouds, timelapse, 6 seconds" },
];

const ratio = (r: string) => r.split(":").map(Number) as [number, number];

const tile =
  "group flex w-full flex-col overflow-hidden rounded-xl border border-line bg-surface text-left inset-shadow-edge transition hover:border-line-strong active:scale-[0.98]";

function Chips({ labels }: { labels: string[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {labels.slice(0, 4).map((l) => (
        <span key={l} className="rounded-md border border-line px-1.5 py-0.5 text-2xs tabular-nums text-fg-muted">
          {l}
        </span>
      ))}
    </span>
  );
}

export function InspirationFeed({
  recent,
  onPick,
  onRemix,
}: {
  recent: Generation[];
  onPick: (prompt: string, labels: string[]) => void;
  onRemix: (gen: Generation) => void;
}) {
  return (
    <div className="flex flex-col gap-8">
      {recent.length > 0 && (
        <section aria-labelledby="your-recent" className="flex flex-col gap-3">
          <h2 id="your-recent" className="text-xs font-medium text-fg-muted">Remix your recent</h2>
          {/* A real grid, not columns: newest-first order must survive in tab order. */}
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {recent.map((g) => (
              <li key={g.id}>
                <button onClick={() => onRemix(g)} className={tile}>
                  <span className="relative block aspect-[4/3] w-full bg-stage">
                    {g.status === "done" && <ResultMedia url={g.resultUrl} alt="" sizes="(min-width: 768px) 25vw, 50vw" />}
                    <span className="glass-media absolute right-2 top-2 flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs text-fg opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                      <ArrowsClockwise size={11} aria-hidden /> Remix
                    </span>
                  </span>
                  <span className="line-clamp-1 px-3 py-2 text-ui text-fg [overflow-wrap:anywhere]">{g.intent.prompt}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="presets" className="flex flex-col gap-3">
        <h2 id="presets" className="text-xs font-medium text-fg-muted">Start from a preset</h2>
        {/* Native CSS columns for masonry; tab order runs down each column, which is fine for unordered presets. */}
        <ul className="columns-2 gap-3 md:columns-3 xl:columns-4">
          {PRESETS.map(({ id, prompt }, i) => {
            const intent = parseIntent(prompt);
            const labels = intentLabels(intent);
            const [w, h] = ratio(intent.aspectRatio);
            return (
              <li key={id} className="mb-3 break-inside-avoid">
                <button onClick={() => onPick(prompt, labels)} className={tile}>
                  <span style={{ aspectRatio: `${w} / ${h}` }} className="relative block w-full overflow-hidden bg-stage">
                    <Image
                      src={`/presets/${id}.jpg`}
                      alt=""
                      fill
                      sizes="(min-width: 1280px) 280px, (min-width: 768px) 33vw, 50vw"
                      priority={i < 4}
                      className="object-cover transition-transform duration-500 motion-safe:group-hover:scale-[1.03]"
                    />
                    {intent.media === "video" && (
                      <span className="glass-media absolute left-2 top-2 flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs text-fg">
                        <FilmStrip size={11} aria-hidden /> Video
                      </span>
                    )}
                  </span>
                  <span className="flex flex-col gap-2 p-3">
                    <span className="line-clamp-2 text-ui text-fg [overflow-wrap:anywhere]">{prompt}</span>
                    <Chips labels={labels} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

/** Recent finished runs worth remixing: stills only, so the empty state never autoplays video. */
export const remixable = (runs: Generation[]) =>
  runs.filter((g) => g.status === "done" && !g.demoFallback && !isVideo(g.resultUrl)).slice(0, 4);
