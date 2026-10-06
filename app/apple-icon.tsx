import { ImageResponse } from "next/og";
import { HEX, SPARK } from "@/components/logo";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Full-bleed tile: iOS applies its own rounded mask. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: HEX.accent }}>
        <svg width="120" height="120" viewBox="0 0 24 24">
          <path d={SPARK} fill={HEX.ink} transform="translate(-4.8 -4.8) scale(1.4)" />
        </svg>
      </div>
    ),
    size,
  );
}
