import {
  repositoryRawSourceUrl,
  repositorySourceUrl,
} from "../../config/project";

/** Public bookmarks now lead to the original technical references on GitHub. */
const references = {
  architecture: "docs/architecture/navigation.md",
  "natural-language": "docs/architecture/natural-language.md",
  backend: "docs/guides/backend.md",
  contributing: "CONTRIBUTING.md",
};
export const documentationRedirects: Readonly<Record<string, string>> =
  Object.fromEntries(
    Object.entries(references).flatMap(([slug, source]) => {
      const page = new URL(source, repositorySourceUrl).href;
      return [
        [`/docs/${slug}`, page],
        [`/docs/${slug}/`, page],
        [`/docs/${slug}.html`, page],
        [`/docs/${slug}.md`, new URL(source, repositoryRawSourceUrl).href],
      ];
    }),
  );

export function documentationRedirect(path: string, hash = "") {
  const destination = documentationRedirects[path];
  if (!destination) return undefined;
  const url = new URL(destination);
  url.hash = hash;
  return url.href;
}
