import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { StudioSidebar } from "@/components/history-sidebar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Intent Studio",
  description: "Describe what you want to make. See the exact cost before you run it, and failed runs refund themselves.",
  // Absolute URLs for the Open Graph image; Vercel sets VERCEL_PROJECT_PRODUCTION_URL in production.
  metadataBase: new URL(process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000"),
};

// Dark before CSS arrives: no white flash on first paint, dark native controls, dark mobile browser chrome.
export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#050608", // --bg, oklch(0.12 0.006 260)
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-[100dvh] flex-col font-sans text-ui md:flex-row">
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
      </body>
    </html>
  );
}
