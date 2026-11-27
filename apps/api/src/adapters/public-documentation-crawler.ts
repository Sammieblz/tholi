import { lookup as dnsLookup } from "node:dns/promises";
import type { ClientRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { parseHTML } from "linkedom";
import { ORGANIZATION_LIMITS } from "../../../../packages/navigation-core/contracts-organization";
import type { PublicDocumentationCrawler } from "../application/organization";

const PAGE_LIMIT = ORGANIZATION_LIMITS.crawlPages;

function ipv4Value(address: string): bigint | undefined {
  if (isIP(address) !== 4) return;
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => part < 0 || part > 255))
    return;
  return parts.reduce((value, part) => (value << 8n) | BigInt(part), 0n);
}

function ipv6Value(address: string): bigint | undefined {
  if (isIP(address) !== 6 || address.includes("%")) return;
  const halves = address.toLowerCase().split("::");
  if (halves.length > 2) return;
  const parseHalf = (half: string) => (half ? half.split(":") : []);
  const left = parseHalf(halves[0]);
  const right = parseHalf(halves[1] || "");
  const groups = [...left, ...right];
  const ipv4 = groups.at(-1)?.includes(".") ? groups.pop() : undefined;
  if (ipv4) {
    const value = ipv4Value(ipv4);
    if (value === undefined) return;
    groups.push(
      Number((value >> 16n) & 0xffffn).toString(16),
      Number(value & 0xffffn).toString(16),
    );
  }
  const missing = 8 - groups.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return;
  const expanded = [...left, ...Array(missing).fill("0"), ...right];
  if (ipv4) {
    const value = ipv4Value(ipv4);
    if (value === undefined) return;
    expanded.push(
      Number((value >> 16n) & 0xffffn).toString(16),
      Number(value & 0xffffn).toString(16),
    );
  }
  if (
    expanded.length !== 8 ||
    expanded.some((part) => !/^[0-9a-f]{1,4}$/.test(part))
  )
    return;
  return expanded.reduce(
    (value, part) => (value << 16n) | BigInt("0x" + part),
    0n,
  );
}

function inV4(address: bigint, base: number[], prefix: number) {
  const network = base.reduce(
    (value, part) => (value << 8n) | BigInt(part),
    0n,
  );
  const shift = BigInt(32 - prefix);
  return address >> shift === network >> shift;
}

function inV6(address: bigint, networkHex: string, prefix: number) {
  const network = BigInt(networkHex);
  const shift = BigInt(128 - prefix);
  return address >> shift === network >> shift;
}

/** Reject special-use, private, loopback, link-local, documentation and multicast IPs. */
export function isPublicDocumentationAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4Value(address);
    if (value === undefined) return false;
    const blocked: [number[], number][] = [
      [[0, 0, 0, 0], 8],
      [[10, 0, 0, 0], 8],
      [[100, 64, 0, 0], 10],
      [[127, 0, 0, 0], 8],
      [[169, 254, 0, 0], 16],
      [[172, 16, 0, 0], 12],
      [[192, 0, 0, 0], 24],
      [[192, 0, 2, 0], 24],
      [[192, 88, 99, 0], 24],
      [[192, 168, 0, 0], 16],
      [[198, 18, 0, 0], 15],
      [[198, 51, 100, 0], 24],
      [[203, 0, 113, 0], 24],
      [[224, 0, 0, 0], 4],
      [[240, 0, 0, 0], 4],
    ];
    return !blocked.some(([base, prefix]) => inV4(value, base, prefix));
  }
  if (family !== 6) return false;
  const value = ipv6Value(address);
  if (value === undefined || value >> 125n !== 1n) return false;
  return ![
    ["0x20010000000000000000000000000000", 23], // IETF special-purpose block
    ["0x20010db8000000000000000000000000", 32], // documentation
    ["0x20020000000000000000000000000000", 16], // 6to4
    ["0x3fff0000000000000000000000000000", 20], // documentation
  ].some(([network, prefix]) =>
    inV6(value, network as string, prefix as number),
  );
}

async function resolvePublicAddress(hostname: string) {
  const unwrapped = hostname.replace(/^\[|\]$/g, "");
  if (isIP(unwrapped)) {
    if (!isPublicDocumentationAddress(unwrapped)) throw Error("CRAWL_BLOCKED");
    return { address: unwrapped, family: isIP(unwrapped) };
  }
  const resolved = await dnsLookup(unwrapped, { all: true, verbatim: true });
  if (
    !resolved.length ||
    resolved.some((item) => !isPublicDocumentationAddress(item.address))
  )
    throw Error("CRAWL_BLOCKED");
  return resolved[0];
}

type Fetched = {
  status: number;
  contentType: string;
  location?: string;
  body: string;
};
type RequestPage = (
  url: URL,
  signal: AbortSignal,
  maxBytes: number,
) => Promise<Fetched>;

function requestPinned(
  url: URL,
  signal: AbortSignal,
  maxBytes: number,
): Promise<Fetched> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let request: ClientRequest | undefined;
    const finish = (error?: Error, value?: Fetched) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      error ? reject(error) : resolve(value!);
    };
    const abort = () => {
      request?.destroy(Error("CRAWL_CANCELLED"));
      finish(Error("CRAWL_CANCELLED"));
    };
    const timer = setTimeout(() => {
      request?.destroy(Error("CRAWL_TIMEOUT"));
      finish(Error("CRAWL_TIMEOUT"));
    }, ORGANIZATION_LIMITS.crawlRequestMs);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    void resolvePublicAddress(url.hostname)
      .then((resolved) => {
        if (settled) return;
        request = httpsRequest(
          url,
          {
            method: "GET",
            headers: {
              Accept:
                "text/html,application/xhtml+xml,text/plain,application/xml,text/xml;q=0.8",
              "User-Agent": "TholiPublicDocsBot/0.11 (+https://tholi.io/docs)",
              Host: url.host,
            },
            family: resolved.family,
            lookup: (_hostname, _options, callback) =>
              callback(null, resolved.address, resolved.family),
            ...(isIP(url.hostname) ? {} : { servername: url.hostname }),
          },
          (response) => {
            const status = response.statusCode ?? 0;
            const location = response.headers.location;
            if (status >= 300 && status < 400) {
              response.destroy();
              finish(undefined, {
                status,
                contentType: String(response.headers["content-type"] || ""),
                location: typeof location === "string" ? location : undefined,
                body: "",
              });
              return;
            }
            const chunks: Buffer[] = [];
            let bytes = 0;
            response.on("data", (raw: Buffer | string) => {
              const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
              bytes += chunk.byteLength;
              if (bytes > maxBytes) {
                response.destroy(Error("CRAWL_SIZE_LIMIT"));
                return;
              }
              chunks.push(chunk);
            });
            response.once("error", (error) => finish(error));
            response.once("end", () => {
              try {
                finish(undefined, {
                  status,
                  contentType: String(response.headers["content-type"] || ""),
                  body: new TextDecoder("utf-8", { fatal: true }).decode(
                    Buffer.concat(chunks),
                  ),
                });
              } catch {
                finish(Error("CRAWL_UNSUPPORTED"));
              }
            });
          },
        );
        request.once("error", (error) => finish(error));
        if (signal.aborted) abort();
        else request.end();
      })
      .catch((error: unknown) =>
        finish(error instanceof Error ? error : Error("CRAWL_UNAVAILABLE")),
      );
  });
}

type RobotsRule = { allow: boolean; pattern: string };
function robotsRules(body: string): RobotsRule[] {
  const groups: { agents: string[]; rules: RobotsRule[] }[] = [];
  let current: (typeof groups)[number] | undefined;
  for (const line of body.split(/\r?\n/)) {
    const clean = line.split("#", 1)[0].trim();
    const colon = clean.indexOf(":");
    if (colon < 1) continue;
    const key = clean.slice(0, colon).trim().toLowerCase();
    const value = clean.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (!current || current.rules.length) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && current && value) {
      current.rules.push({ allow: key === "allow", pattern: value });
    }
  }
  const selected = groups.filter((group) =>
    group.agents.some(
      (agent) => agent === "tholipublicdocsbot" || agent === "*",
    ),
  );
  const specificity = (group: (typeof groups)[number]) =>
    group.agents.includes("tholipublicdocsbot") ? 2 : 1;
  const highest = Math.max(0, ...selected.map(specificity));
  return selected
    .filter((group) => specificity(group) === highest)
    .flatMap((group) => group.rules);
}

function robotsAllows(pathname: string, rules: RobotsRule[]) {
  const matches = rules
    .filter(({ pattern }) => {
      const anchored = pattern.endsWith("$");
      const literal = anchored ? pattern.slice(0, -1) : pattern;
      const parts = literal.split("*");
      const prefix = parts.shift()!;
      if (!pathname.startsWith(prefix)) return false;
      if (!parts.length) return !anchored || pathname === prefix;
      const suffix = anchored ? parts.pop()! : "";
      if (!pathname.endsWith(suffix)) return false;
      const end = pathname.length - suffix.length;
      let offset = prefix.length;
      for (const part of parts) {
        if (!part) continue;
        const found = pathname.indexOf(part, offset);
        if (found < 0) return false;
        offset = found + part.length;
      }
      return offset <= end;
    })
    .sort(
      (a, b) =>
        b.pattern.length - a.pattern.length ||
        Number(b.allow) - Number(a.allow),
    );
  return matches[0]?.allow ?? true;
}

function canonicalPage(value: string, origin: string, prefix: string) {
  try {
    const url = new URL(value, origin);
    const path = decodeURIComponent(url.pathname);
    if (
      url.protocol !== "https:" ||
      url.origin !== origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !(
        url.pathname.startsWith(prefix) || url.pathname === prefix.slice(0, -1)
      ) ||
      path.includes("\\") ||
      /\/(?:login|signin|sign-in|account|admin|logout|checkout)(?:\/|$)/i.test(
        path,
      ) ||
      /\.(?:pdf|docx?|xlsx?|zip|png|jpe?g|gif|svg|woff2?|css|js)$/i.test(path)
    )
      return;
    return url;
  } catch {
    return;
  }
}

function sitemapLocations(body: string, origin: string, prefix: string) {
  const links: URL[] = [];
  const pattern = /<loc\b[^>]*>([\s\S]*?)<\/loc\s*>/gi;
  for (const match of body.matchAll(pattern)) {
    const candidate = match[1].replace(/&amp;/g, "&").trim();
    const page = canonicalPage(candidate, origin, prefix);
    if (page) links.push(page);
    if (links.length >= ORGANIZATION_LIMITS.crawlSitemapUrls) break;
  }
  return links;
}

function parsePage(html: string, url: URL) {
  const { document } = parseHTML(html);
  const title =
    document.querySelector("main h1, article h1, h1")?.textContent?.trim() ||
    document.querySelector("title")?.textContent?.trim() ||
    url.pathname;
  const root = document.querySelector("main,article") || document.body;
  const links: string[] = [];
  for (const anchor of root.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href");
    if (href && links.length < ORGANIZATION_LIMITS.crawlLinks) links.push(href);
  }
  return { title: title.replace(/\s+/g, " ").slice(0, 120), links };
}

async function requestFollowingSameOrigin(
  start: URL,
  origin: string,
  signal: AbortSignal,
  maxBytes: number,
  request: RequestPage,
  allowed: (url: URL) => boolean = () => true,
): Promise<{ url: URL; response: Fetched }> {
  let url = start;
  for (let redirects = 0; ; redirects++) {
    signal.throwIfAborted();
    if (!allowed(url)) throw Error("CRAWL_SCOPE_BLOCKED");
    const response = await request(url, signal, maxBytes);
    if (response.status < 300 || response.status >= 400 || !response.location)
      return { url, response };
    if (redirects >= ORGANIZATION_LIMITS.crawlRedirects)
      throw Error("CRAWL_REDIRECT_LIMIT");
    const next = new URL(response.location, url);
    if (
      next.protocol !== "https:" ||
      next.origin !== origin ||
      !canonicalPage(next.href, origin, "/")
    )
      throw Error("CRAWL_REDIRECT_BLOCKED");
    next.hash = "";
    next.search = "";
    url = next;
  }
}

/** Public, same-origin, HTTPS-only documentation discovery with a pinned DNS connection. */
export function createPublicDocumentationCrawler(
  request: RequestPage = requestPinned,
): PublicDocumentationCrawler {
  return {
    async crawl(input, signal) {
      const origin = input.origin;
      const seed = canonicalPage(input.url, origin, "/");
      if (!seed || seed.href !== input.url) throw Error("CRAWL_INVALID_URL");
      const lastSlash = seed.pathname.lastIndexOf("/");
      const prefix = seed.pathname.endsWith("/")
        ? seed.pathname
        : /\.[a-z0-9]{1,8}$/i.test(seed.pathname)
          ? seed.pathname.slice(0, lastSlash + 1) || "/"
          : seed.pathname + "/";
      const robotsUrl = new URL("/robots.txt", origin);
      const robots = await requestFollowingSameOrigin(
        robotsUrl,
        origin,
        signal,
        ORGANIZATION_LIMITS.crawlRobotsBytes,
        request,
      );
      if (robots.response.status !== 200 && robots.response.status !== 404)
        throw Error("CRAWL_ROBOTS_UNAVAILABLE");
      const rules =
        robots.response.status === 200 ? robotsRules(robots.response.body) : [];
      const candidates = new Map<string, URL>();
      const add = (url: URL | undefined) => {
        if (url && candidates.size < ORGANIZATION_LIMITS.crawlSitemapUrls)
          candidates.set(url.href, url);
      };
      add(seed);
      const sitemapLine =
        robots.response.status === 200
          ? robots.response.body.match(/^\s*sitemap\s*:\s*(\S+)/im)?.[1]
          : undefined;
      const sitemapUrl = canonicalPage(
        sitemapLine || new URL("/sitemap.xml", origin).href,
        origin,
        "/",
      );
      if (sitemapUrl) {
        try {
          const sitemap = await requestFollowingSameOrigin(
            sitemapUrl,
            origin,
            signal,
            ORGANIZATION_LIMITS.crawlRobotsBytes,
            request,
            (page) => robotsAllows(page.pathname, rules),
          );
          if (
            sitemap.response.status === 200 &&
            /(?:xml|text\/plain)/i.test(sitemap.response.contentType)
          )
            for (const page of sitemapLocations(
              sitemap.response.body,
              origin,
              prefix,
            ))
              add(page);
        } catch (error) {
          if (signal.aborted) throw error;
        }
      }
      const visited = new Set<string>();
      const documents: { url: string; title: string; html: string }[] = [];
      let skipped = 0;
      while (
        candidates.size &&
        documents.length < PAGE_LIMIT &&
        visited.size < ORGANIZATION_LIMITS.crawlSitemapUrls
      ) {
        const url = candidates.values().next().value as URL;
        candidates.delete(url.href);
        if (visited.has(url.href)) continue;
        visited.add(url.href);
        signal.throwIfAborted();
        if (!robotsAllows(url.pathname, rules)) {
          skipped++;
          continue;
        }
        try {
          const { url: finalUrl, response } = await requestFollowingSameOrigin(
            url,
            origin,
            signal,
            ORGANIZATION_LIMITS.crawlPageBytes,
            request,
            (page) =>
              !!canonicalPage(page.href, origin, prefix) &&
              robotsAllows(page.pathname, rules),
          );
          if (
            response.status !== 200 ||
            !canonicalPage(finalUrl.href, origin, prefix) ||
            !/text\/html|application\/xhtml\+xml/i.test(response.contentType)
          ) {
            skipped++;
            continue;
          }
          const parsed = parsePage(response.body, finalUrl);
          documents.push({
            url: finalUrl.href,
            title: parsed.title,
            html: response.body,
          });
          if (documents.length === 1 && candidates.size === 0) {
            for (const href of parsed.links) {
              const link = URL.parse(href, finalUrl);
              if (link) add(canonicalPage(link.href, origin, prefix));
            }
          }
        } catch (error) {
          if (signal.aborted) throw error;
          skipped++;
        }
      }
      return { documents, visited: visited.size, skipped };
    },
  };
}
