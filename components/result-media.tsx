import Image from "next/image";
import type { SyntheticEvent } from "react";
import { reducedMotion } from "@/lib/motion";

export const isVideo = (url: string) => /\.(mp4|webm)$/i.test(new URL(url).pathname);

const videoIn = (e: SyntheticEvent<HTMLElement>) => e.currentTarget.querySelector("video");
const play = (e: SyntheticEvent<HTMLElement>) => {
  if (!reducedMotion()) void videoIn(e)?.play().catch(() => {}); // play() rejects if interrupted by a quick pause; harmless
};
const pause = (e: SyntheticEvent<HTMLElement>) => videoIn(e)?.pause();

/** Spread on a tile: its video previews only while hovered or focused, never under reduced motion (WCAG 2.2.2). */
export const hoverPlay = { onPointerEnter: play, onPointerLeave: pause, onFocus: play, onBlur: pause };

/** Real renders can be video files; the local simulator returns stills. Videos never autoplay. */
export function ResultMedia({ url, alt, sizes, className = "", controls = false }: { url: string; alt: string; sizes: string; className?: string; controls?: boolean }) {
  return isVideo(url) ? (
    // #t=0.1 + preload=metadata paints the first frame as a poster without downloading the clip.
    <video src={`${url}#t=0.1`} aria-label={alt} preload="metadata" muted loop playsInline controls={controls} className={`absolute inset-0 h-full w-full object-cover ${className}`} />
  ) : (
    <Image src={url} alt={alt} fill sizes={sizes} className={`object-cover ${className}`} />
  );
}
