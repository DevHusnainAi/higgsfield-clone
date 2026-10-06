import Image from "next/image";

export const isVideo = (url: string) => /\.(mp4|webm)$/i.test(new URL(url).pathname);

/** Real renders can be video files; the local simulator returns stills. */
export function ResultMedia({ url, alt, sizes, className = "", controls = false }: { url: string; alt: string; sizes: string; className?: string; controls?: boolean }) {
  return isVideo(url) ? (
    <video src={url} aria-label={alt} autoPlay muted loop playsInline controls={controls} className={`absolute inset-0 h-full w-full object-cover ${className}`} />
  ) : (
    <Image src={url} alt={alt} fill sizes={sizes} className={`object-cover ${className}`} />
  );
}
