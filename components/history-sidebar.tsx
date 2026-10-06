import Link from "next/link";
import { ClockCounterClockwise, Plus } from "@phosphor-icons/react/dist/ssr";

// ponytail: static empty state; real history (and a mobile drawer) lands with the generation store
export function HistorySidebar() {
  return (
    <aside className="sticky top-0 hidden h-[100dvh] w-72 shrink-0 flex-col border-r border-line bg-surface md:flex">
      <div className="flex h-16 items-center justify-between px-5">
        <span className="text-[15px] font-semibold tracking-tight">Studio</span>
        <Link
          href="/"
          aria-label="New generation"
          className="grid size-8 place-items-center rounded-full text-fg-muted transition hover:bg-surface-raised hover:text-fg active:scale-[0.96]"
        >
          <Plus size={16} weight="bold" />
        </Link>
      </div>

      <nav aria-label="History" className="flex flex-1 flex-col px-3 pb-4">
        <h2 className="px-2 pb-2 text-xs font-medium text-fg-muted">History</h2>
        <div className="mx-2 mt-2 flex flex-col items-start gap-3 rounded-xl border border-dashed border-line p-4">
          <ClockCounterClockwise size={20} className="text-fg-muted" />
          <p className="text-sm leading-relaxed text-fg-muted">
            Everything you generate shows up here, with its prompt, settings and credit cost.
          </p>
        </div>
      </nav>
    </aside>
  );
}
