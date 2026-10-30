import { beforeEach, expect, it, vi } from "vitest";
import type { ResolvedConfig } from "vite";
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
        { path: "/account", index: false },
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

function configured() {
  const plugin = staticSite();
  (plugin.configResolved as (config: ResolvedConfig) => void)({
    root: "apps/web",
    build: { outDir: "../../dist/web" },
    mode: "production",
  } as ResolvedConfig);
  (plugin.generateBundle as (options: unknown, bundle: unknown) => void)(
    {},
    {
      entry: {
        type: "chunk",
        fileName: "assets/index-1234abcd.js",
        name: "index",
      },
    },
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

it("invalidates an earlier operator fragment before a new build and rejects untracked public assets", async () => {
  const plugin = staticSite();
  await (plugin.buildStart as () => Promise<void>)();
  expect(fixture.remove).toHaveBeenCalledWith(
    expect.stringContaining("nginx-locations.conf"),
    { force: true },
  );
  const current = configured();
  fixture.entries.push({ name: "account.json", isFile: () => true });
  await expect((current.closeBundle as () => Promise<void>)()).rejects.toThrow(
    "asset output differs",
  );
  expect(fixture.writes.size).toBe(0);
});

it("publishes the operator fragment outside public assets only after static rendering and server cleanup succeed", async () => {
  const plugin = configured();
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
