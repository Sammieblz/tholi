import { defineConfig } from "vite";
import websiteRelease from "./release.json";
import { staticSite } from "./build/static-site";
export default defineConfig({
  plugins: [
    staticSite(),
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
    outDir: "../../dist/web",
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
