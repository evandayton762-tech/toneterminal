import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  api: {
    bodyParser: {
      sizeLimit: "32mb",
    },
  },
};

export default nextConfig;
