/** Shared static-delivery policy. No credentials or application state belong here. */
export const WEBSITE_CACHE = Object.freeze({
  private: "private, no-store",
  immutable: "public, max-age=31536000, immutable",
  revalidate: "no-cache",
});
const privatePrefixes = Object.freeze([
  "account",
  "auth",
  "signin",
  "signup",
  "welcome",
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
]);
const mutablePrefixes = Object.freeze([
  "icons",
  "media",
  "licenses",
  "downloads",
  "fonts",
]);
const generatedAsset =
  /^assets\/[A-Za-z0-9._-]+-[A-Za-z0-9_-]{8}\.(?:js|css|woff2?)$/;

export function createWebsiteDelivery(
  assetPaths,
  publicPaths = [],
  accountAliases = {},
) {
  if (
    !Array.isArray(assetPaths) ||
    assetPaths.some(
      (path) => typeof path !== "string" || !generatedAsset.test(path),
    )
  )
    throw new Error(
      "Website assets must be generated content-hashed JavaScript, CSS or fonts.",
    );
  const assets = [...new Set(assetPaths)].sort();
  if (assets.length !== assetPaths.length)
    throw new Error("Website asset paths must be unique.");
  const publicPath = (path) =>
    typeof path === "string" &&
    /^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/.test(path);
  if (
    !Array.isArray(publicPaths) ||
    publicPaths.some((path) => !publicPath(path))
  )
    throw new Error("Invalid public website path.");
  const canonicalPaths = new Set(publicPaths);
  if (
    !accountAliases ||
    typeof accountAliases !== "object" ||
    Array.isArray(accountAliases) ||
    Object.entries(accountAliases).some(
      ([path, destination]) =>
        !publicPath(path) ||
        path === "/" ||
        canonicalPaths.has(path) ||
        !canonicalPaths.has(destination) ||
        destination === "/",
    )
  )
    throw new Error("Invalid rendered website alias.");
  const renderedPaths = new Map([
    ...publicPaths.map((path) => [path, path]),
    ...Object.entries(accountAliases),
  ]);
  const approved = new Set(assets.map((path) => "/" + path));
  const privatePath = (path) =>
    privatePrefixes.some(
      (prefix) =>
        path === `/${prefix}` ||
        path === `/${prefix}.html` ||
        path.startsWith(`/${prefix}/`) ||
        path.startsWith(`/${prefix}.html/`),
    );
  const classify = (value) => {
    // Policy inputs are URL paths, never complete URLs, credentials or queries.
    const path = typeof value === "string" ? value.split(/[?#]/, 1)[0] : "";
    if (approved.has(path)) return "immutable";
    if (mutablePrefixes.some((prefix) => path.startsWith(`/${prefix}/`)))
      return "revalidate";
    return "private";
  };
  const headers = (path) => ({
    "Cache-Control": WEBSITE_CACHE[classify(path)],
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    ...(privatePath(path.split(/[?#]/, 1)[0])
      ? { "X-Robots-Tag": "noindex" }
      : {}),
  });

  const cloudflareHeaders = () => {
    // Cloudflare combines matching headers. Cache rules deliberately partition
    // actual assets/shells instead of combining a blanket no-store with immutable.
    const rules = [
      [
        "/*",
        {
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY",
          "Referrer-Policy": "no-referrer",
        },
      ],
      ["/", { "Cache-Control": WEBSITE_CACHE.private }],
      ["/:page", { "Cache-Control": WEBSITE_CACHE.private }],
      ["/docs/*", { "Cache-Control": WEBSITE_CACHE.private }],
      ...assets.map((path) => [
        "/" + path,
        { "Cache-Control": WEBSITE_CACHE.immutable },
      ]),
      ...mutablePrefixes.map((prefix) => [
        `/${prefix}/*`,
        { "Cache-Control": WEBSITE_CACHE.revalidate },
      ]),
      ...[...renderedPaths.keys()]
        .filter(privatePath)
        .flatMap((path) =>
          [path, path + ".html"].map((alias) => [
            alias,
            { "X-Robots-Tag": "noindex" },
          ]),
        ),
      ...privatePrefixes.flatMap((prefix) =>
        [prefix, prefix + ".html"].map((alias) => [
          `/${alias}/*`,
          {
            "Cache-Control": WEBSITE_CACHE.private,
            "X-Robots-Tag": "noindex",
          },
        ]),
      ),
      ...[...renderedPaths.keys()]
        .filter(
          (path) =>
            path !== "/" &&
            !path.startsWith("/docs/") &&
            path !== "/docs" &&
            !privatePath(path),
        )
        .flatMap((path) => [
          ...(path.slice(1).includes("/")
            ? [path, path + ".html"].map((alias) => [
                alias,
                { "Cache-Control": WEBSITE_CACHE.private },
              ])
            : []),
          [path + "/", { "Cache-Control": WEBSITE_CACHE.private }],
        ]),
      ["/llms.txt", { "Content-Type": "text/plain; charset=utf-8" }],
      ["/llms-full.txt", { "Content-Type": "text/plain; charset=utf-8" }],
      ["/docs/*.md", { "Content-Type": "text/markdown; charset=utf-8" }],
    ];
    if (rules.length > 100)
      throw new Error(
        "Website delivery exceeds Cloudflare's 100-header-rule limit.",
      );
    const result = rules
      .map(
        ([path, values]) =>
          `${path}\n${Object.entries(values)
            .map(([name, value]) => `  ${name}: ${value}`)
            .join("\n")}\n`,
      )
      .join("");
    if (result.split("\n").some((line) => line.length > 2000))
      throw new Error(
        "Website delivery exceeds Cloudflare's header-line limit.",
      );
    return result;
  };

  const nginxLocations = () => {
    const location = (match, cache, directive) =>
      `${match} {\n  add_header Cache-Control "${cache}" always;\n  add_header X-Content-Type-Options nosniff always;\n  add_header X-Frame-Options DENY always;\n  add_header Referrer-Policy no-referrer always;\n  ${directive}\n}\n`;
    return (
      "# Set root to the deployed dist/web directory and include this file inside its server block, not the API server.\n" +
      "include /etc/nginx/mime.types;\ndefault_type application/octet-stream;\n" +
      assets
        .map((path) =>
          location(
            `location = /${path}`,
            WEBSITE_CACHE.immutable,
            "try_files $uri =404;",
          ),
        )
        .join("\n") +
      location("location ^~ /assets/", WEBSITE_CACHE.private, "return 404;") +
      mutablePrefixes
        .map((prefix) =>
          location(
            `location ^~ /${prefix}/`,
            WEBSITE_CACHE.revalidate,
            "try_files $uri =404;",
          ),
        )
        .join("\n") +
      ["/_headers", "/_redirects"]
        .map((path) =>
          location(`location = ${path}`, WEBSITE_CACHE.private, "return 404;"),
        )
        .join("\n") +
      [...renderedPaths]
        .filter(([path]) => path !== "/")
        .flatMap(([path, destination]) =>
          [path + "/", path + ".html/"].map((alias) =>
            location(
              `location = ${alias}`,
              WEBSITE_CACHE.private,
              `try_files ${destination}.html =404;`,
            ),
          ),
        )
        .join("\n") +
      location(
        "location /",
        WEBSITE_CACHE.private,
        "try_files $uri $uri.html $uri/index.html =404;",
      )
    );
  };
  return Object.freeze({
    assets: Object.freeze(assets),
    classify,
    headers,
    cloudflareHeaders,
    nginxLocations,
  });
}
