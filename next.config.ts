import type { NextConfig } from "next";

const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL;

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      new URL("https://picsum.photos/**"), // local simulator + starter cards
      ...(supabase ? [new URL(`${supabase}/storage/v1/object/public/generations/**`)] : []),
    ],
  },
};

export default nextConfig;
