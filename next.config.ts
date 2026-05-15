import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
    ],
  },
  // pdf-to-img / pdfjs-dist use a Node-side worker that Turbopack can't
  // resolve through the .next/dev bundle (it produces a "fake worker
  // failed" error trying to import pdf.worker.mjs from a chunk path).
  // Marking them external means Next loads them at runtime from
  // node_modules — workers and all — like a normal Node module. This is
  // the Next-recommended pattern for native + worker-heavy server libs
  // and also keeps sharp's native binary out of the bundler.
  serverExternalPackages: ["pdf-to-img", "pdfjs-dist", "sharp"],
};

export default nextConfig;
