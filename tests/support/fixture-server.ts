import { createServer } from "node:http";
import { acceptanceHtml } from "../fixtures/acceptance/page";
export async function acceptanceServer(routes: Record<string, string> = {}) {
  const server = createServer((request, response) => {
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(
      routes[new URL(request.url || "/", "http://localhost").pathname] ||
        acceptanceHtml,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("Fixture server unavailable");
  return {
    url: `http://127.0.0.1:${address.port}/acceptance/fixture`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
