import type { NextConfig } from "next";

// Static export for GitHub Pages: everything runs in the browser, no server.
// PAGES_BASE_PATH is set by the Pages workflow ("/wing-scene-generator"); empty locally.
const nextConfig: NextConfig = {
  output: "export",
  basePath: process.env.PAGES_BASE_PATH || "",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
