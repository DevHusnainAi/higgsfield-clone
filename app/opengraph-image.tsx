import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { FRAME, HEX, SPARK } from "@/components/logo";
import { intentLabels } from "@/lib/labels";
import { estimateCost } from "@/lib/generation";
import { parseIntent } from "@/lib/intent";

export const alt = "Intent Studio: describe it, see the exact cost, and failed runs refund themselves.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The composer shown is the real thing: these chips and this cost come from the app's own parser.
const PROMPT = "Slow dolly-in on pour-over coffee brewing, vertical video, 6s";

export default async function OpengraphImage() {
  const [medium, semibold] = await Promise.all([
    readFile(join(process.cwd(), "assets/Geist-500.ttf")),
    readFile(join(process.cwd(), "assets/Geist-600.ttf")),
  ]);
  const intent = parseIntent(PROMPT);
  const chips = intentLabels(intent).slice(0, 4);

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: HEX.bg, color: HEX.fg, fontFamily: "Geist" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <svg width="44" height="44" viewBox="0 0 24 24">
            <path d={FRAME} fill="none" stroke={HEX.fg} strokeWidth="2" strokeLinecap="round" />
            <path d={SPARK} fill={HEX.accent} />
          </svg>
          <span style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-0.015em" }}>Intent Studio</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 64, fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1.05 }}>
          <span>Describe it. See the exact cost.</span>
          <span style={{ color: HEX.muted }}>Failed runs refund themselves.</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18, padding: 24, borderRadius: 20, background: HEX.raised, border: "1px solid rgba(255,255,255,0.1)" }}>
          <span style={{ fontSize: 26, fontWeight: 500 }}>{PROMPT}</span>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: 10 }}>
              {chips.map((c) => (
                <span key={c} style={{ padding: "6px 16px", borderRadius: 999, fontSize: 20, fontWeight: 500, border: "1px solid rgba(255,255,255,0.16)", background: "rgba(255,255,255,0.06)" }}>
                  {c}
                </span>
              ))}
            </div>
            <span style={{ padding: "10px 24px", borderRadius: 999, fontSize: 22, fontWeight: 600, background: HEX.accent, color: HEX.ink }}>
              Generate · {estimateCost(intent)} credits
            </span>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Geist", data: medium, weight: 500, style: "normal" },
        { name: "Geist", data: semibold, weight: 600, style: "normal" },
      ],
    },
  );
}
