import { readFile } from "node:fs/promises";
import backendDataPermissions from "./backend-data-permissions.json" with { type: "json" };
export const extensionTargets = {
  chromium: "dist/extension",
  firefox: "dist/extension-firefox",
};
export async function extensionManifest(target) {
  const common = JSON.parse(
    await readFile("apps/extension/manifest.json", "utf8"),
  );
  if (target === "chromium")
    return { ...common, minimum_chrome_version: "140" };
  if (target !== "firefox") throw Error("Unknown browser target");
  const { side_panel, ...manifest } = common;
  return {
    ...manifest,
    permissions: common.permissions.filter(
      (p) => !["offscreen", "sidePanel"].includes(p),
    ),
    background: { scripts: ["worker.js"], persistent: false },
    sidebar_action: {
      default_title: "Tholi",
      default_panel: side_panel.default_path,
      open_at_install: false,
    },
    browser_specific_settings: {
      gecko: {
        id: "tholi@ilunonsen.com",
        strict_min_version: "153.0",
        data_collection_permissions: {
          required: ["none"],
          optional: backendDataPermissions,
        },
      },
    },
  };
}
