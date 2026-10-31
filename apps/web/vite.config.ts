import { defineConfig } from "vite";
import websiteRelease from "./release.json";
import { staticSite } from "./build/static-site";
import { websiteArtifactDirectory } from "../../scripts/artifact-files.mjs";
import { resolve } from "node:path";
const websiteDirectory = websiteArtifactDirectory();
export default defineConfig({
  plugins: [
    staticSite({
      deploymentDirectory: process.env.THOLI_IDENTITY_WEB_DIRECTORY
        ? resolve(websiteDirectory, "../website-deploy")
        : undefined,
    }),
    {
      name: "website-release-metadata",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "website-release.json",
          source: JSON.stringify(websiteRelease) + "\n",
        });
      },
    },
  ],
  root: "apps/web",
  publicDir: "../public",
  server: { host: "127.0.0.1", port: 5174, strictPort: true },
  build: {
    outDir: websiteDirectory,
    emptyOutDir: true,
    rollupOptions: {
      onwarn(warning, warn) {
        if (
          warning.code === "MODULE_LEVEL_DIRECTIVE" &&
          warning.message.includes('"use client"')
        )
          return;
        warn(warning);
      },
    },
  },
});
