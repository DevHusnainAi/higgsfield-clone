// Intent Studio mark: a camera viewfinder (the frame you're aiming for) around a spark (the prompt).
// One path set shared by the sidebar, favicon, Apple icon and Open Graph image. Hex values mirror the
// OKLCH tokens in globals.css for renderers that don't support oklch() (favicons, next/og).

export const SPARK = "M12 6.5C12.55 9.9 14.1 11.45 17.5 12C14.1 12.55 12.55 14.1 12 17.5C11.45 14.1 9.9 12.55 6.5 12C9.9 11.45 11.45 9.9 12 6.5Z";
export const FRAME =
  "M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8M21 16v2.5a2.5 2.5 0 0 1-2.5 2.5H16M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16";
export const HEX = { bg: "#050608", raised: "#121417", fg: "#edeef1", muted: "#9da2a9", accent: "#f58b4b", ink: "#1c0d06" } as const;

/** Frame in currentColor, spark in the accent. Decorative: pair it with the visible name. */
export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <path d={FRAME} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d={SPARK} fill="var(--accent)" />
    </svg>
  );
}
