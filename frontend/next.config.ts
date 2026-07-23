import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["maplibre-gl"],
  experimental: {
    optimizePackageImports: ["recharts"],
  },
};

export default nextConfig;
