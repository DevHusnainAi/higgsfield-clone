"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ImageSquare, Trash, UploadSimple, X } from "@phosphor-icons/react";
import { VIDEO_RATIOS, type AspectRatio } from "@/lib/intent";
import { deleteReference, listReferences, MAX_REFERENCES, referencePreviewUrl, REFERENCE_TYPES } from "@/lib/remote";
import { anchor, anchoredTo, closePopover, popoverClass } from "./param-chips";

/** The supported video ratio closest to an image's shape, so the frame isn't cropped hard. */
export function nearestVideoRatio(width: number, height: number): AspectRatio {
  const off = (r: AspectRatio) => {
    const [w, h] = r.split(":").map(Number);
    return Math.abs(Math.log(w / h / (width / height)));
  };
  return [...VIDEO_RATIOS].sort((a, b) => off(a) - off(b))[0];
}

type Saved = { path: string; url: string };

/** Image button + popover: upload a new start frame, or reuse / delete one of your last 10. */
export function ReferenceLibrary({
  attached,
  uploading,
  onUpload,
  onPick,
  onDeleted,
}: {
  attached: string | null;
  uploading: boolean;
  onUpload: (file: File) => void;
  onPick: (frame: Saved, ratio: AspectRatio) => void;
  onDeleted: (path: string) => void;
}) {
  const [saved, setSaved] = useState<Saved[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const full = (saved?.length ?? 0) >= MAX_REFERENCES;

  function load() {
    setError(null);
    listReferences()
      .then(setSaved)
      .catch((err) => {
        console.error("[studio] loading start frames failed", err);
        setError("Couldn't load your start frames.");
      });
  }

  async function remove(path: string) {
    setSaved((list) => list?.filter((f) => f.path !== path) ?? null);
    try {
      await deleteReference(path);
      onDeleted(path);
    } catch (err) {
      console.error("[studio] deleting start frame failed", err);
      setError("Couldn't delete that frame.");
      load();
    }
  }

  return (
    <>
      <button
        type="button"
        popoverTarget="reference-library"
        style={anchor("--references")}
        aria-label="Start frame"
        title="Start frame"
        className="grid size-9 shrink-0 place-items-center rounded-full border border-line text-fg-muted inset-shadow-edge transition hover:border-line-strong hover:text-fg active:scale-[0.96]"
      >
        <ImageSquare size={16} />
      </button>

      <div
        id="reference-library"
        popover="auto"
        aria-label="Start frames"
        style={anchoredTo("--references")}
        onToggle={(e) => (e as unknown as ToggleEvent).newState === "open" && load()}
        className={`${popoverClass} w-[min(20rem,calc(100vw-2rem))] p-4`}
      >
        <div className="flex items-baseline justify-between pb-3">
          <h3 className="text-sm font-semibold">Start frames</h3>
          {saved && (
            <span className="font-mono text-xs tabular-nums text-fg-muted">
              {saved.length} / {MAX_REFERENCES}
            </span>
          )}
        </div>

        <label className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong text-sm font-medium text-fg transition hover:border-fg-muted has-focus-visible:outline-2 has-focus-visible:outline-accent has-disabled:cursor-not-allowed has-disabled:opacity-40">
          <UploadSimple size={14} />
          {uploading ? "Uploading…" : "Upload new"}
          <input
            type="file"
            accept={Object.keys(REFERENCE_TYPES).join(",")}
            disabled={uploading || full}
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // picking the same file again still fires
              if (!file) return;
              onUpload(file);
              closePopover(e.currentTarget);
            }}
          />
        </label>
        <p className="pt-1.5 text-xs text-fg-muted">
          {full ? "Library full. Delete a frame to upload another." : "PNG, JPEG or WebP up to 5 MB. Kept here for reuse."}
        </p>

        {error && <p role="alert" className="pt-2 text-xs text-danger">{error}</p>}

        <div className="mt-3 grid grid-cols-3 gap-2">
          {saved === null && !error && Array.from({ length: 3 }, (_, i) => <div key={i} className="shimmer aspect-square rounded-lg" />)}
          {saved?.map((frame) => (
            <div key={frame.path} className="group relative aspect-square">
              <button
                type="button"
                aria-label="Use this start frame"
                aria-pressed={frame.path === attached}
                onClick={(e) => {
                  const img = e.currentTarget.querySelector("img");
                  onPick(frame, nearestVideoRatio(img?.naturalWidth || 16, img?.naturalHeight || 9));
                  closePopover(e.currentTarget);
                }}
                className="relative size-full overflow-hidden rounded-lg border border-line bg-surface transition hover:border-fg-muted aria-pressed:border-accent aria-pressed:ring-1 aria-pressed:ring-accent"
              >
                <Image src={frame.url} alt="" fill unoptimized sizes="96px" className="object-cover" />
              </button>
              <button
                type="button"
                aria-label="Delete this start frame"
                onClick={() => void remove(frame.path)}
                className="glass absolute right-1 top-1 grid size-6 place-items-center rounded-full text-fg opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
              >
                <Trash size={12} />
              </button>
            </div>
          ))}
        </div>
        {saved?.length === 0 && <p className="text-xs text-fg-muted">No start frames yet.</p>}
      </div>
    </>
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
