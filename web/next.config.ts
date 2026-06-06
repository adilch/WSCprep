import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    FFA_SERVICE_URL: process.env.FFA_SERVICE_URL ?? "http://localhost:8000",
  },
};

export default nextConfig;
