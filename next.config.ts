import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ponytail: mock renderer output; replace with the real asset host
  images: { remotePatterns: [new URL("https://picsum.photos/**")] },
};

export default nextConfig;
