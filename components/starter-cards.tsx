import Image from "next/image";

// Each example exercises a different part of the parser. Photos chosen to match: picsum ids 1067, 1027, 1060.
const STARTERS = [
  { id: 1067, prompt: "Drone shot over a city skyline at golden hour, 10s" },
  { id: 1027, prompt: "Portrait photo of a woman in soft window light, 4:5" },
  { id: 1060, prompt: "Slow dolly-in on pour-over coffee brewing, vertical video, 6s" },
];

const FAN = [
  "-rotate-3 sm:-rotate-6 translate-y-3 motion-safe:group-hover/fan:-translate-x-4 motion-safe:group-hover/fan:-rotate-9",
  "z-10",
  "rotate-3 sm:rotate-6 translate-y-3 motion-safe:group-hover/fan:translate-x-4 motion-safe:group-hover/fan:rotate-9",
];

export function StarterCards({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <ul aria-label="Example prompts" className="group/fan flex justify-center py-4">
      {STARTERS.map(({ id, prompt }, i) => (
        <li key={id} className={`-mx-1.5 w-30 sm:-mx-2 sm:w-44 ${FAN[i]} transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] hover:z-20`}>
          <button
            onClick={() => onPick(prompt)}
            className="group/card flex w-full flex-col overflow-hidden rounded-xl border border-line bg-surface-raised text-left shadow-float inset-shadow-edge transition duration-300 hover:border-line-strong motion-safe:hover:-translate-y-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <div className="relative aspect-[4/5] w-full">
              <Image
                src={`https://picsum.photos/id/${id}/400/500`}
                alt=""
                fill
                sizes="176px"
                priority={i === 1}
                className="object-cover"
              />
            </div>
            <span className="line-clamp-3 p-3 text-xs leading-relaxed text-fg-muted group-hover/card:text-fg">{prompt}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
