import type { NextConfig } from "next";

const config: NextConfig = {
  // Os pacotes do workspace são consumidos como TypeScript puro, sem build.
  transpilePackages: ["@videoeditor/core", "@videoeditor/renderer"],
};

export default config;
