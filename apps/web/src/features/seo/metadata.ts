import product from "../../../../../package.json" with { type: "json" };
import { publicOrigin, repositoryUrl } from "../../config/project";
import { articleCatalog } from "../docs/catalog";
import { browsers, stores } from "../downloads/browsers";
import { legalOperator } from "../legal/operator";

export type PageMetadata = {
  path: string;
  title: string;
  description: string;
  label: string;
  chunk?: string;
  index: boolean;
};
const page = (
  path: string,
  title: string,
  description: string,
  label: string,
  chunk?: string,
  index = true,
): PageMetadata => ({ path, title, description, label, chunk, index });
export const publicPages: PageMetadata[] = [
  page(
    "/",
    "Tholi | Local website guidance for Chrome and Firefox",
    "Find your next step through website menus and controls with Tholi. A local browser guide for Chrome and Firefox. No Tholi account required.",
    "Home",
  ),
  page(
    "/about",
    "About Tholi | A patient guide for the web",
    "Meet Tholi, a local website guide named after umtholi, the Zulu word for finder. Built by ILUNỌNSEN LLC to help you navigate while staying in control.",
    "About",
    "AboutPage",
  ),
  page(
    "/download",
    "Get Tholi | Add to Chrome or Firefox",
    "Install Tholi from the Chrome Web Store or Firefox Add-ons. Local processing, no Tholi account required, and optional developer installation.",
    "Get Tholi",
    "DownloadPage",
  ),
  page(
    "/docs",
    "Tholi documentation | Setup, guidance and privacy",
    "Learn how to install Tholi, start website guidance, manage local data and understand permissions, navigation limits and optional backend connections.",
    "Documentation",
    "DocsPage",
  ),
  page(
    "/support",
    "Tholi support | Installation and navigation help",
    "Get help installing Tholi, granting website access and troubleshooting browser guidance. Find practical answers and contact Tholi support.",
    "Support",
    "SupportPage",
  ),
  page(
    "/contact",
    "Contact Tholi | Support, feedback and partnerships",
    "Contact the team behind Tholi for support, feedback or partnerships. Prepare an email draft on the website and send it through your email app.",
    "Contact",
    "ContactPage",
  ),
  page(
    "/privacy",
    "Tholi privacy notice | Local data and your controls",
    "Read how Tholi handles page context, local browser data, optional backend connections and website measurements. Learn about your privacy controls.",
    "Privacy",
    "LegalPage",
  ),
  page(
    "/terms",
    "Tholi terms of use | Guidance and your decisions",
    "Read the terms for Tholi's website and local browser extension, including user control, browser-store distribution and navigation limitations.",
    "Terms",
    "LegalPage",
  ),
  page(
    "/cookies",
    "Tholi cookie notice | Appearance and measurement",
    "Understand Tholi's essential and optional appearance cookies, Cloudflare measurements and how to change your website cookie choices.",
    "Cookies",
    "LegalPage",
  ),
  ...articleCatalog.map((article) =>
    page(
      `/docs/${article.slug}`,
      `${article.title} | Tholi documentation`,
      article.description,
      article.title,
      "DocsPage",
    ),
  ),
  page(
    "/onboarding",
    "Practice with Tholi | Optional account-free walkthrough",
    "Explore installation and try Tholi in an isolated sample website. No Tholi account required. Practice cannot confirm an extension installation.",
    "Practice",
    "OnboardingPage",
    false,
  ),
];
export const retiredAccountPaths = ["/signin", "/signup", "/welcome"];
export function metadataForPath(value: string): PageMetadata {
  const path = new URL(value, publicOrigin).pathname.replace(/\/+$/, "") || "/";
  if (retiredAccountPaths.includes(path))
    return {
      ...publicPages.find((p) => p.path === "/download")!,
      index: false,
    };
  return (
    publicPages.find((p) => p.path === path) ??
    page(
      path,
      "Page not found | Tholi",
      "This page is not available. Find Tholi installation, documentation and support from the website navigation.",
      "Page not found",
      undefined,
      false,
    )
  );
}
export const socialImage = {
  path: "/media/social/tholi-social.png",
  width: 1200,
  height: 630,
  alt: "Tholi. Your next step, made clear. Local website guidance for Chrome and Firefox.",
};
export const absoluteUrl = (path: string) => new URL(path, publicOrigin).href;
export function structuredData(metadata: PageMetadata) {
  const organization = `${publicOrigin}/#organization`;
  const website = `${publicOrigin}/#website`;
  const application = `${publicOrigin}/#application`;
  const url = absoluteUrl(metadata.path);
  const article = articleCatalog.find(
    (item) => metadata.path === `/docs/${item.slug}`,
  );
  const graph: object[] = [
    {
      "@type": "Organization",
      "@id": organization,
      name: legalOperator.name,
      url: legalOperator.companyUrl,
      contactPoint: {
        "@type": "ContactPoint",
        contactType: "customer support",
        email: legalOperator.email,
        url: absoluteUrl("/support"),
      },
    },
    {
      "@type": "WebSite",
      "@id": website,
      name: "Tholi",
      url: publicOrigin + "/",
      inLanguage: "en",
      publisher: { "@id": organization },
    },
    {
      "@type":
        metadata.path === "/about"
          ? "AboutPage"
          : metadata.path === "/contact"
            ? "ContactPage"
            : "WebPage",
      "@id": url + "#webpage",
      url,
      name: metadata.title,
      description: metadata.description,
      inLanguage: "en",
      isPartOf: { "@id": website },
      about: { "@id": application },
      primaryImageOfPage: {
        "@type": "ImageObject",
        url: absoluteUrl(socialImage.path),
        width: socialImage.width,
        height: socialImage.height,
      },
    },
  ];
  if (metadata.path === "/" || metadata.path === "/download")
    graph.push({
      "@type": "SoftwareApplication",
      "@id": application,
      name: "Tholi",
      url: publicOrigin + "/",
      description: product.description,
      applicationCategory: "BrowserApplication",
      operatingSystem: "Desktop browser",
      softwareVersion: product.version,
      inLanguage: "en",
      isAccessibleForFree: true,
      browserRequirements: `Chrome (${browsers[0].minimum}+) or ${browsers.find((browser) => browser.id === "firefox")!.minimum}+`,
      image: absoluteUrl(socialImage.path),
      logo: absoluteUrl("/icons/icon-512.png"),
      publisher: { "@id": organization },
      license: `${repositoryUrl}/blob/main/LICENSE`,
      installUrl: [stores.chromium.url, stores.firefox.url],
      sameAs: [stores.chromium.url, stores.firefox.url, repositoryUrl],
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        url: absoluteUrl("/download"),
      },
    });
  if (article)
    graph.push({
      "@type": "TechArticle",
      "@id": url + "#article",
      headline: article.title,
      description: article.description,
      inLanguage: "en",
      mainEntityOfPage: { "@id": url + "#webpage" },
      author: { "@id": organization },
      publisher: { "@id": organization },
      url,
    });
  if (metadata.path !== "/" && metadata.index) {
    const crumbs = [
      { name: "Tholi", item: publicOrigin + "/" },
      ...(article
        ? [{ name: "Documentation", item: absoluteUrl("/docs") }]
        : []),
      { name: metadata.label, item: url },
    ];
    graph.push({
      "@type": "BreadcrumbList",
      "@id": url + "#breadcrumbs",
      itemListElement: crumbs.map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        ...item,
      })),
    });
  }
  return { "@context": "https://schema.org", "@graph": graph };
}
export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
export const safeJson = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
export function seoTags(metadata: PageMetadata) {
  const meta = (key: string, value: string, property = false) =>
    `<meta data-tholi-seo ${property ? "property" : "name"}="${key}" content="${escapeHtml(value)}">`;
  const tags = [
    `<title data-tholi-seo>${escapeHtml(metadata.title)}</title>`,
    meta("description", metadata.description),
    meta(
      "robots",
      metadata.index
        ? "index, follow, max-image-preview:large"
        : "noindex, follow",
    ),
    `<link data-tholi-seo rel="canonical" href="${escapeHtml(absoluteUrl(metadata.path))}">`,
    `<link data-tholi-seo rel="describedby" type="text/plain" href="/llms.txt">`,
    ...Object.entries({
      "og:site_name": "Tholi",
      "og:locale": "en_US",
      "og:type": metadata.path.startsWith("/docs/") ? "article" : "website",
      "og:title": metadata.title,
      "og:description": metadata.description,
      "og:url": absoluteUrl(metadata.path),
      "og:image": absoluteUrl(socialImage.path),
      "og:image:type": "image/png",
      "og:image:width": String(socialImage.width),
      "og:image:height": String(socialImage.height),
      "og:image:alt": socialImage.alt,
    }).map(([key, value]) => meta(key, value, true)),
    ...Object.entries({
      "twitter:card": "summary_large_image",
      "twitter:title": metadata.title,
      "twitter:description": metadata.description,
      "twitter:image": absoluteUrl(socialImage.path),
      "twitter:image:alt": socialImage.alt,
    }).map(([key, value]) => meta(key, value)),
    `<script data-tholi-seo type="application/ld+json">${safeJson(structuredData(metadata))}</script>`,
  ];
  if (metadata.path.startsWith("/docs/") && metadata.index)
    tags.push(
      `<link data-tholi-seo rel="alternate" type="text/markdown" href="${escapeHtml(absoluteUrl(metadata.path + ".md"))}">`,
    );
  return tags.join("\n");
}
