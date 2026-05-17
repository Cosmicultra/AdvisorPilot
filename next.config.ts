import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // CRITICAL: pin Turbopack's workspace root to the project directory.
  //
  // There's a `package-lock.json` at the developer's home directory
  // (`/Users/djperussina/package-lock.json`) AND at the project root,
  // which makes Next.js guess wrong about the workspace. Without this
  // setting Next.js prints:
  //   "We detected multiple lockfiles and selected the directory of
  //    /Users/djperussina/package-lock.json as the root directory."
  // and Turbopack ends up rooting its file-scan at the home directory.
  // For routes already compiled at boot that's invisible, but the first
  // time a NEW route segment hits the dev server (e.g. /print/reports/
  // [id] when we shipped it) the compile pass walks tens of thousands
  // of irrelevant files under ~/ and effectively hangs.
  //
  // Pinning the root to the project directory makes Turbopack scan only
  // the AdvisorPilot tree and the bundled node_modules — first-compile
  // of new routes drops from "minutes / hangs forever" to sub-second.
  turbopack: {
    root: path.resolve(__dirname),
  },
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
