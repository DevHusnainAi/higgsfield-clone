import type { Metadata } from "next";
import { Settings } from "@/components/settings";

export const metadata: Metadata = { title: "Settings · Intent Studio" };

/** Inside the studio shell, so the sidebar stays; its links bring you back to the workspace. */
export default function SettingsPage() {
  return <Settings />;
}
