"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ImageSquare, X } from "@phosphor-icons/react";
import { VIDEO_RATIOS, type AspectRatio } from "@/lib/intent";
import { referencePreviewUrl, REFERENCE_TYPES } from "@/lib/remote";

/** The supported video ratio closest to the image's own shape, so the frame isn't cropped hard. */
export async function nearestVideoRatio(file: File): Promise<AspectRatio> {
  const { width, height } = await createImageBitmap(file);
  const off = (r: AspectRatio) => {
    const [w, h] = r.split(":").map(Number);
    return Math.abs(Math.log(w / h / (width / height)));
  };
  return [...VIDEO_RATIOS].sort((a, b) => off(a) - off(b))[0];
}

export function ReferenceButton({ onFile, disabled }: { onFile: (file: File) => void; disabled: boolean }) {
  return (
    <label
      title="Add a start frame"
      className="relative grid size-9 shrink-0 cursor-pointer place-items-center rounded-full border border-line text-fg-muted inset-shadow-edge transition hover:border-line-strong hover:text-fg has-focus-visible:outline-2 has-focus-visible:outline-accent has-disabled:cursor-not-allowed has-disabled:opacity-40"
    >
      <ImageSquare size={16} />
      <input
        type="file"
        accept={Object.keys(REFERENCE_TYPES).join(",")}
        aria-label="Add a start frame"
        disabled={disabled}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ""; // picking the same file again still fires
          if (file) onFile(file);
        }}
      />
    </label>
  );
}

/** Thumbnail of the attached start frame. `localUrl` shows instantly while the private link is fetched. */
export function ReferencePreview({ path, localUrl, uploading, onRemove }: { path: string | null; localUrl: string | null; uploading: boolean; onRemove: () => void }) {
  const [signed, setSigned] = useState<{ path: string; url: string } | null>(null);
  useEffect(() => {
    if (!path || localUrl) return;
    let live = true;
    referencePreviewUrl(path)
      .then((url) => live && setSigned({ path, url }))
      .catch((err) => console.error("[studio] start frame preview failed", err));
    return () => {
      live = false;
    };
  }, [path, localUrl]);
  const src = localUrl ?? (signed?.path === path ? signed.url : null);

  return (
    <div className="flex items-center gap-3 px-2 pt-1">
      <div className="relative size-14 shrink-0 overflow-hidden rounded-lg border border-line bg-surface">
        {src ? <Image src={src} alt="Start frame" fill unoptimized sizes="56px" className="object-cover" /> : <div className="shimmer absolute inset-0" />}
        {uploading && <div className="shimmer absolute inset-0 opacity-70" />}
      </div>
      <p className="min-w-0 flex-1 text-xs leading-relaxed text-fg-muted">
        <span className="font-medium text-fg">{uploading ? "Uploading start frame…" : "Start frame"}</span>
        <br />
        The video opens on this image.
      </p>
      <button
        type="button"
        onClick={onRemove}
        disabled={uploading}
        aria-label="Remove start frame"
        className="grid size-7 shrink-0 place-items-center rounded-full text-fg-muted transition hover:bg-fg/[0.06] hover:text-fg disabled:opacity-40"
      >
        <X size={14} />
      </button>
    </div>
  );
}
