import type { NextConfig } from "next";

const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL;
// `supabase start` serves storage from 127.0.0.1, which Next 16 refuses to optimize by default.
// Allowed only when our own Supabase is local; a hosted (supabase.co) setup keeps the protection.
const localSupabase = supabase ? ["127.0.0.1", "localhost"].includes(new URL(supabase).hostname) : false;

const nextConfig: NextConfig = {
  images: {
    dangerouslyAllowLocalIP: localSupabase,
    remotePatterns: [
      new URL("https://picsum.photos/**"), // local simulator + starter cards
      ...(supabase ? [new URL(`${supabase}/storage/v1/object/public/generations/**`)] : []),
    ],
  },
};

export default nextConfig;
