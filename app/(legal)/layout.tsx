import Link from "next/link";
import { ArrowLeft, Info } from "@phosphor-icons/react/ssr";
import { Logo } from "@/components/logo";
import { SOURCE } from "./legal";

/** Plain reading layout for the policies. No sidebar and no session: reading these never creates a guest account. */
export default function LegalLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-16 pt-8 md:pt-12">
      <nav aria-label="Site" className="flex items-center justify-between">
        <Link
          href="/"
          className="flex h-9 items-center gap-2 rounded-full border border-line px-3.5 text-ui font-medium text-fg-muted inset-shadow-edge transition hover:border-line-strong hover:text-fg active:scale-[0.98]"
        >
          <ArrowLeft size={14} weight="bold" aria-hidden /> Back to studio
        </Link>
        <span className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-fg">
          <Logo /> Intent Studio
        </span>
      </nav>

      <p role="note" className="flex items-start gap-3 rounded-xl border border-accent/40 bg-accent/10 p-4 text-ui text-fg">
        <Info size={18} weight="fill" className="mt-px shrink-0 text-accent-text" aria-hidden />
        <span>
          <strong className="font-semibold">Intent Studio is a technical demonstration and portfolio project, not a commercial product.</strong>{" "}
          Data is stored strictly for demonstration purposes.
        </span>
      </p>

      <main
        className="flex flex-col gap-4 text-sm leading-relaxed text-fg-muted [&_a]:text-accent-text [&_a]:underline [&_a]:underline-offset-2 [&_h1]:text-3xl [&_h1]:font-semibold [&_h1]:tracking-display [&_h1]:text-fg [&_h2]:mt-6 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:tracking-heading [&_h2]:text-fg [&_li]:pl-1 [&_strong]:font-medium [&_strong]:text-fg [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-1.5 [&_ul]:pl-5"
      >
        {children}
      </main>

      <footer className="flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-6 text-xs text-fg-muted">
        <Link href="/privacy" className="hover:text-fg">Privacy Policy</Link>
        <Link href="/terms" className="hover:text-fg">Terms of Service</Link>
        <a href={SOURCE} className="hover:text-fg">Source code</a>
      </footer>
    </div>
  );
}

