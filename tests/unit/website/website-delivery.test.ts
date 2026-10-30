import { describe, expect, it } from "vitest";
import {
  createWebsiteDelivery,
  WEBSITE_CACHE,
} from "../../../scripts/lib/website-delivery.mjs";
import {
  accountAliases,
  accountPath,
} from "../../../apps/web/src/features/account/paths";

const assets = [
  "assets/index-ABCDef12.js",
  "assets/theme-1234abcd.css",
  "assets/newsreader-Abcd_123.woff2",
];
const delivery = createWebsiteDelivery(
  assets,
  [
    "/",
    "/about",
    "/docs",
    "/docs/getting-started",
    "/account",
    "/signin",
    "/signup",
    "/help/start",
  ],
  accountAliases,
);

// Cloudflare merges every matching rule rather than selecting the last rule.
function appliedHeaders(text: string, target: string) {
  const result: Record<string, string[]> = {};
  let matches = false;
  const path = target.split(/[?#]/, 1)[0];
  for (const line of text.trimEnd().split("\n")) {
    if (!line.startsWith(" ")) {
      const pattern = line
        .split("/")
        .map((part) =>
          part === "*"
            ? ".*"
            : part.startsWith(":")
              ? "[^/]+"
              : part
                  .split("*")
                  .map((literal) =>
                    literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
                  )
                  .join(".*"),
        )
        .join("/");
      matches = new RegExp("^" + pattern + "$").test(path);
    } else if (matches) {
      const separator = line.indexOf(":");
      const name = line.slice(0, separator).trim();
      (result[name] ??= []).push(line.slice(separator + 1).trim());
    }
  }
  return result;
}

describe("shared static website delivery", () => {
  it("admits only an explicit inventory of generated content-hashed JS, CSS and fonts", () => {
    for (const paths of [
      ["assets/app.js"],
      ["assets/capture-1234abcd.png"],
      ["assets/account-1234abcd.json"],
      ["../assets/app-1234abcd.js"],
      ["assets/app-1234abcd.js?query=1"],
      [...assets, assets[0]],
    ])
      expect(() => createWebsiteDelivery(paths)).toThrow();
    expect(() =>
      createWebsiteDelivery(assets, ["/account\nInjected"]),
    ).toThrow();
    const invalidAliases: Record<string, string>[] = [
      { "/welcome\nInjected": "/account" },
      { "/welcome": "/missing" },
      { "/account": "/account" },
    ];
    for (const aliases of invalidAliases)
      expect(() =>
        createWebsiteDelivery(assets, ["/account"], aliases),
      ).toThrow("Invalid rendered website alias");
    expect(delivery.assets).toEqual([...assets].sort());
    expect(Object.isFrozen(delivery.assets)).toBe(true);
    for (const path of assets)
      expect(delivery.headers("/" + path)["Cache-Control"]).toBe(
        WEBSITE_CACHE.immutable,
      );
    expect(delivery.classify("/assets/untracked-1234abcd.js")).toBe("private");
    for (const path of [
      "/icons/icon-192.png",
      "/media/social/tholi-social.png",
      "/downloads/manifest.json",
    ])
      expect(delivery.headers(path)["Cache-Control"]).toBe(
        WEBSITE_CACHE.revalidate,
      );
  });

  it("keeps private aliases, callbacks and query-bearing public shells out of shared caches without conflicting Cloudflare headers", () => {
    const text = delivery.cloudflareHeaders();
    const privateTargets = [
      "/",
      "/index.html",
      "/download?code=DO_NOT_CACHE",
      "/about/",
      "/website-release.json",
      "/site.webmanifest",
      "/docs/getting-started",
      "/docs/security.md",
      "/docs/",
      "/help/start",
      "/help/start.html",
      "/help/start/",
      ...[
        "account",
        "signin",
        "signup",
        "welcome",
        "auth",
        "credits",
        "saved-data",
        "exports",
        "callback",
        "api",
        "decisions",
        "captures",
        "files",
        "billing",
        "settings",
      ].flatMap((prefix) => [
        `/${prefix}`,
        `/${prefix}/`,
        `/${prefix}.html`,
        `/${prefix}.html/`,
        `/${prefix}/nested/private?code=DO_NOT_CACHE`,
      ]),
    ];
    for (const path of privateTargets) {
      expect(delivery.classify(path), path).toBe("private");
      expect(appliedHeaders(text, path)["Cache-Control"], path).toEqual([
        WEBSITE_CACHE.private,
      ]);
      expect(
        appliedHeaders(text, "/assets/untracked-1234abcd.js")["Cache-Control"],
      ).toBeUndefined();
    }
    for (const path of assets)
      expect(appliedHeaders(text, "/" + path)["Cache-Control"]).toEqual([
        WEBSITE_CACHE.immutable,
      ]);
    expect(
      appliedHeaders(text, "/icons/icon-192.png")["Cache-Control"],
    ).toEqual([WEBSITE_CACHE.revalidate]);
    expect(
      appliedHeaders(text, "/auth/callback?code=DO_NOT_CACHE")[
        "Referrer-Policy"
      ],
    ).toEqual(["no-referrer"]);
    expect(appliedHeaders(text, "/account.html")["X-Robots-Tag"]).toEqual([
      "noindex",
    ]);
    expect(appliedHeaders(text, "/docs/security.md")["Content-Type"]).toEqual([
      "text/markdown; charset=utf-8",
    ]);
    expect(
      text.split("\n").filter((line) => line.startsWith("/")).length,
    ).toBeLessThanOrEqual(100);
    expect(text.split("\n").every((line) => line.length <= 2000)).toBe(true);
    expect(() =>
      createWebsiteDelivery(
        [],
        Array.from({ length: 101 }, (_, i) => `/page-${i}`),
      ).cloudflareHeaders(),
    ).toThrow("100-header-rule");
  });

  it("renders a portable static Nginx adapter from the same approved assets and excludes control files", () => {
    const config = delivery.nginxLocations();
    expect(config).toContain("root to the deployed dist/web directory");
    expect(config).toContain(
      "include /etc/nginx/mime.types;\ndefault_type application/octet-stream;",
    );
    for (const path of assets) {
      expect(config).toContain(`location = /${path}`);
      expect(config).toContain(
        `add_header Cache-Control "${WEBSITE_CACHE.immutable}" always;`,
      );
    }
    expect(config).toContain(
      'location ^~ /assets/ {\n  add_header Cache-Control "private, no-store" always;',
    );
    expect(config).toContain("location = /_headers");
    expect(config).toContain("location = /_redirects");
    expect(config).toContain("try_files $uri $uri.html $uri/index.html =404;");
    for (const [path, destination] of [
      ["/account", "/account"],
      ["/welcome", "/account"],
      ["/help/start", "/help/start"],
    ])
      for (const alias of [path + "/", path + ".html/"])
        expect(config).toContain(
          `location = ${alias} {\n  add_header Cache-Control "private, no-store" always;\n  add_header X-Content-Type-Options nosniff always;\n  add_header X-Frame-Options DENY always;\n  add_header Referrer-Policy no-referrer always;\n  try_files ${destination}.html =404;\n}`,
        );
    expect(config).not.toMatch(/return 30[1278]|rewrite|\$args|\$query_string/);
    expect(config).not.toMatch(/proxy_pass|cookie|authorization|secret/i);
  });

  it("shares account bookmark aliases without introducing a cacheable welcome redirect", () => {
    expect(accountAliases).toEqual({ "/welcome": "/account" });
    for (const path of [
      "/welcome",
      "/welcome/",
      "/welcome.html",
      "/welcome.html/",
    ])
      expect(accountPath(path)).toBe("/welcome");
    expect(accountPath("/account.html")).toBe("/account");
    expect(accountPath("/account/unknown")).toBeUndefined();
    expect(
      accountPath("https://untrusted.example.test/account"),
    ).toBeUndefined();
  });
});
