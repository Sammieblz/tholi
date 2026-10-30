import { prerenderToNodeStream } from "react-dom/static";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "./app/App";
import { StaticRouter } from "./app/router";
import { PreferencesProvider } from "./features/preferences";
export {
  publicPages,
  accountAliases,
  metadataForPath,
  seoTags,
  absoluteUrl,
  escapeHtml,
} from "./features/seo/metadata";
export { articles, resolveDocumentationLink } from "./features/docs/registry";
export { publicOrigin, repositoryUrl } from "./config/project";
export { stores } from "./features/downloads/browsers";
export { documentationRedirects } from "./features/docs/redirects";

/** Render actual public components, without cookies, a browser or extension state. */
export async function renderPage(path: string): Promise<string> {
  let renderError: unknown;
  const tree = (
    <PreferencesProvider
      cookieAccess={{ read: () => "", write: () => {}, secure: true }}
    >
      <StaticRouter path={path}>
        <App />
      </StaticRouter>
    </PreferencesProvider>
  );
  const { prelude, postponed } = await prerenderToNodeStream(tree, {
    signal: AbortSignal.timeout(15_000),
    onError(error) {
      renderError = error;
    },
  });
  if (renderError) throw renderError;
  if (postponed) throw new Error(`Incomplete static rendering: ${path}`);
  for await (const chunk of prelude) void chunk;
  // Serialize the now-resolved tree as plain markup, without streaming patch
  // scripts or hidden Suspense fragments that require JavaScript to reveal.
  const html = renderToStaticMarkup(tree);
  if (html.includes("Opening this page"))
    throw new Error(`Unresolved static content: ${path}`);
  // Native links work immediately. Form controls activate only when the client
  // mounts their real handlers, so static contact forms cannot send a GET.
  return html.replace(
    /<(button|input|select|textarea)\b(?![^>]*\bdisabled(?:[ =/>]))/g,
    "<$1 disabled",
  );
}
