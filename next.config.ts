import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  api: {
    bodyParser: {
      sizeLimit: "64mb",
    },
  },
};

export default nextConfig;
