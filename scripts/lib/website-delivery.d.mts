export const WEBSITE_CACHE: Readonly<{
  private: "private, no-store";
  immutable: "public, max-age=31536000, immutable";
  revalidate: "no-cache";
}>;
export interface WebsiteDelivery {
  readonly assets: readonly string[];
  classify(path: string): keyof typeof WEBSITE_CACHE;
  headers(path: string): Record<string, string>;
  cloudflareHeaders(): string;
  nginxLocations(): string;
}
export function createWebsiteDelivery(
  assetPaths: string[],
  publicPaths?: string[],
  accountAliases?: Readonly<Record<string, string>>,
): WebsiteDelivery;
