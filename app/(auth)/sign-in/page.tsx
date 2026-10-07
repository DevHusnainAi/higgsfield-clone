import type { Metadata } from "next";
import { AuthExperience } from "@/components/auth/auth-experience";

export const metadata: Metadata = {
  title: "Sign in · Intent Studio",
  description: "Keep your history on every device. New accounts get 40 free credits.",
};

/** Direct load or refresh of /sign-in: the full 50/50 page, outside the studio (so it starts no guest session). */
export default function SignInPage() {
  return <AuthExperience variant="page" />;
}
