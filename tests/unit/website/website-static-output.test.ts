import { beforeEach, expect, it, vi } from "vitest";
import type { ResolvedConfig } from "vite";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { websiteArtifactDirectory } from "../../../scripts/artifact-files.mjs";
const fixture = vi.hoisted(() => ({
  entries: [] as { name: string; isFile(): boolean }[],
  writes: new Map<string, string>(),
  remove: vi.fn(),
  write: vi.fn(),
  close: vi.fn(),
  render: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => {}),
  readFile: vi.fn(
    async () =>
      '<head><!-- tholi:seo:start --><!-- tholi:seo:end --></head><div id="root"></div>',
  ),
  readdir: vi.fn(async () => fixture.entries),
  rm: fixture.remove,
  writeFile: fixture.write,
}));
vi.mock("vite", () => ({
  createServer: vi.fn(async () => ({
    close: fixture.close,
    ssrLoadModule: async () => ({
      publicPages: [
        { path: "/", index: true },
        { path: "/account", index: false, chunk: "AccountRoute" },
      ],
      accountAliases: { "/welcome": "/account" },
      metadataForPath: (path: string) => ({ path }),
      renderPage: fixture.render,
      seoTags: () => "",
      absoluteUrl: (path: string) => "https://tholi.io" + path,
      escapeHtml: (value: string) => value,
      documentationRedirects: {},
      articles: [],
      stores: {
        chromium: { url: "https://chromewebstore.google.com" },
        firefox: { url: "https://addons.mozilla.org" },
      },
      repositoryUrl: "https://github.com/Sammieblz/tholi",
    }),
  })),
}));
import { staticSite } from "../../../apps/web/build/static-site";

async function configured(
  bundle: unknown = {
    entry: {
      type: "chunk",
      fileName: "assets/index-1234abcd.js",
      name: "index",
    },
  },
  options: { deploymentDirectory?: string; outDir?: string } = {},
) {
  const plugin = staticSite(options);
  (plugin.configResolved as (config: ResolvedConfig) => void)({
    root: "apps/web",
    build: { outDir: options.outDir ?? "../../dist/web" },
    mode: "production",
  } as ResolvedConfig);
  await (plugin.buildStart as () => Promise<void>)();
  (plugin.writeBundle as (options: unknown, bundle: unknown) => void)(
    {},
    bundle,
  );
  return plugin;
}
beforeEach(() => {
  vi.clearAllMocks();
  fixture.entries = [{ name: "index-1234abcd.js", isFile: () => true }];
  fixture.writes.clear();
  fixture.remove.mockResolvedValue(undefined);
  fixture.write.mockImplementation(async (path: string, content: string) => {
    fixture.writes.set(path.replaceAll("\\", "/"), content);
  });
  fixture.close.mockResolvedValue(undefined);
  fixture.render.mockResolvedValue("<h1>Public shell</h1>");
});

it("keeps configured local-identity prerendering and its deployment adapter inside the side-build directory", async () => {
  const plugin = await configured(undefined, {
    outDir: "../../output/qa/identity-side/website",
    deploymentDirectory: "output/qa/identity-side/website-deploy",
  });
  await (plugin.closeBundle as () => Promise<void>)();
  const changed = [
    ...fixture.writes.keys(),
    ...fixture.remove.mock.calls.map(([path]) =>
      String(path).replaceAll("\\", "/"),
    ),
  ];
  expect(changed.length).toBeGreaterThan(0);
  expect(
    changed.every((path) => path.includes("/output/qa/identity-side/")),
  ).toBe(true);
  expect(
    changed.some((path) =>
      path.endsWith("/website-deploy/nginx-locations.conf"),
    ),
  ).toBe(true);
});

it("allows an explicit QA identity artifact path without allowing a release-output or unrelated-group override", () => {
  const root = mkdtempSync(join(tmpdir(), "tholi-identity-artifacts-"));
  try {
    mkdirSync(join(root, "output/qa"), { recursive: true });
    const selected = join(root, "output/qa/run/website");
    expect(websiteArtifactDirectory(root, {})).toBe(resolve(root, "dist/web"));
    expect(
      websiteArtifactDirectory(root, {
        THOLI_BROWSER_GROUP: "identity-web",
        THOLI_IDENTITY_WEB_DIRECTORY: selected,
      }),
    ).toBe(selected);
    for (const environment of [
      { THOLI_BROWSER_GROUP: "ui", THOLI_IDENTITY_WEB_DIRECTORY: selected },
      {
        THOLI_BROWSER_GROUP: "identity-web",
        THOLI_IDENTITY_WEB_DIRECTORY: join(root, "dist/web"),
      },
      {
        THOLI_BROWSER_GROUP: "identity-web",
        THOLI_IDENTITY_WEB_DIRECTORY: join(root, "output/qa"),
      },
      {
        THOLI_BROWSER_GROUP: "identity-web",
        THOLI_IDENTITY_WEB_DIRECTORY: "output/qa/run/website",
      },
    ])
      expect(() => websiteArtifactDirectory(root, environment)).toThrow();
  } finally {
    if (!root.startsWith(resolve(tmpdir(), "tholi-identity-artifacts-")))
      throw Error("Unexpected temporary artifact test directory.");
    rmSync(root, { recursive: true, force: true });
  }
});

it("invalidates an earlier operator fragment before a new build and rejects untracked public assets", async () => {
  const plugin = staticSite();
  await (plugin.buildStart as () => Promise<void>)();
  expect(fixture.remove).toHaveBeenCalledWith(
    expect.stringContaining("nginx-locations.conf"),
    { force: true },
  );
  const current = await configured();
  fixture.entries.push({ name: "account.json", isFile: () => true });
  await expect((current.closeBundle as () => Promise<void>)()).rejects.toThrow(
    "asset output differs",
  );
  expect(fixture.writes.size).toBe(0);
});

it("includes late-emitted CSS and route styles from the final written bundle", async () => {
  const stylesheet = "assets/account-1234abcd.css";
  const plugin = await configured({
    entry: {
      type: "chunk",
      fileName: "assets/index-1234abcd.js",
      name: "AccountRoute",
      viteMetadata: { importedCss: new Set([stylesheet]) },
    },
    stylesheet: { type: "asset", fileName: stylesheet },
  });
  fixture.entries.push({ name: "account-1234abcd.css", isFile: () => true });
  await (plugin.closeBundle as () => Promise<void>)();
  const output = (suffix: string) =>
    [...fixture.writes.entries()].find(([path]) => path.endsWith(suffix))?.[1];
  expect(output("/dist/web/_headers")).toContain(
    `/${stylesheet}\n  Cache-Control: public, max-age=31536000, immutable`,
  );
  expect(output("/dist/web/account.html")).toContain(
    `<link rel="stylesheet" href="/${stylesheet}">`,
  );
});

it("publishes the operator fragment outside public assets only after static rendering and server cleanup succeed", async () => {
  const plugin = await configured();
  fixture.close.mockRejectedValueOnce(new Error("SSR cleanup failed"));
  await expect((plugin.closeBundle as () => Promise<void>)()).rejects.toThrow(
    "SSR cleanup failed",
  );
  expect(
    [...fixture.writes.keys()].some((path) =>
      path.endsWith("nginx-locations.conf"),
    ),
  ).toBe(false);
  fixture.writes.clear();
  await (plugin.closeBundle as () => Promise<void>)();
  const path = [...fixture.writes.keys()].find((key) =>
    key.endsWith("nginx-locations.conf"),
  );
  expect(path).toContain("/output/deploy/website/");
  expect(path).not.toContain("/dist/web/");
  expect(fixture.writes.get(path!)).toMatch(
    /location = \/welcome\.html\/ \{[^}]+try_files \/account\.html =404;/,
  );
  expect(
    [...fixture.writes.keys()].some((key) =>
      key.endsWith("/dist/web/welcome.html"),
    ),
  ).toBe(true);
});
