import { AuthExperience } from "@/components/auth/auth-experience";

/**
 * In-app navigation to /sign-in is intercepted here: sign-in opens as a modal over the studio, which stays
 * mounted. `(.)` matches by route segment, and neither the (studio) group nor the @modal slot is a segment,
 * so this intercepts app/(auth)/sign-in. A direct load or refresh renders that page instead.
 */
export default function SignInModal() {
  return <AuthExperience variant="modal" />;
}
