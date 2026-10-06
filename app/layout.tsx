import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
      <body className="min-h-[100dvh] font-sans text-ui">{children}</body>
    </html>
  );
}
