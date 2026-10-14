import { defineConfig } from "vite";
export default defineConfig({
  root: "apps/web",
  publicDir: "../public",
  server: { host: "127.0.0.1", port: 5174, strictPort: true },
  build: { outDir: "../../dist/web", emptyOutDir: true, rollupOptions: {onwarn(warning,warn){if(warning.code === "MODULE_LEVEL_DIRECTIVE" && warning.message.includes('"use client"'))return;warn(warning);}} },
});
