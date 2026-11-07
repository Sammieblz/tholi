import { cp, copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** One portable provider theme; fonts, palette and logo retain their existing owners. */
export async function buildIdentityTheme() {
  // Plain-Node local init/status must not load build-only dependencies.
  const { build } = await import("esbuild");
  const source = "infra/identity/themes/tholi/login";
  const destination = "dist/identity-theme/tholi/login";
  await mkdir(destination + "/resources/img", { recursive: true });
  await cp(source, destination, {
    recursive: true,
    filter: (file) => !file.endsWith(".ts"),
  });
  await build({
    entryPoints: [source + "/resources/js/theme.ts"],
    outfile: destination + "/resources/js/theme.js",
    target: "es2020",
    logLevel: "silent",
  });
  await build({
    entryPoints: [source + "/resources/css/theme.css"],
    outfile: destination + "/resources/css/theme.css",
    bundle: true,
    external: ["../img/tholi_brand_logo.png"],
    loader: { ".woff2": "file" },
    assetNames: "[name]-[hash]",
    logLevel: "silent",
  });
  await copyFile(
    "apps/public/media/tholi_brand_logo.png",
    destination + "/resources/img/tholi_brand_logo.png",
  );
  await mkdir(destination + "/resources/licenses", { recursive: true });
  for (const font of ["manrope", "outfit", "newsreader", "source-sans-3"])
    await copyFile(
      `node_modules/@fontsource-variable/${font}/LICENSE`,
      `${destination}/resources/licenses/${font}-OFL.txt`,
    );
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await buildIdentityTheme();
  console.log(
    "Prepared the portable Tholi identity theme from existing brand assets.",
  );
}
