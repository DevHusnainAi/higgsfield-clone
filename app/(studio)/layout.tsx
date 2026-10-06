import { StudioSidebar } from "@/components/history-sidebar";

/** The app shell: sidebar + workspace. Legal pages live outside it, so reading them starts no guest session. */
export default function StudioLayout({ children, modal }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-[100dvh] flex-col md:flex-row">
      {/* First tab stop. The prompt is the page's main action and sits after the sidebar in DOM order.
          Following a link to a focusable element moves focus to it, so no script is needed. */}
      <a
        href="#prompt"
        className="sr-only rounded-full bg-accent text-sm font-medium text-accent-ink shadow-float focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50"
      >
        {/* Padding lives here: not-sr-only resets the link's own padding to 0. */}
        <span className="block px-4 py-2">Skip to prompt</span>
      </a>
      <StudioSidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-x-clip">{children}</main>
      {modal /* sign-in, intercepted from /sign-in */}
    </div>
  );
}
