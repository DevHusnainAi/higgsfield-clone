import Link from "next/link";
import type { Notice } from "@/lib/store";

/** A notice's text, with its link when it has one (the fallback notice points to Settings). */
export function NoticeText({ notice, onNavigate }: { notice: Notice; onNavigate?: () => void }) {
  if (typeof notice === "string") return notice;
  return (
    <>
      {notice.before}
      <Link href={notice.link.href} onClick={onNavigate} className="font-medium text-accent-text underline underline-offset-2">
        {notice.link.label}
      </Link>
      {notice.after}
    </>
  );
}
