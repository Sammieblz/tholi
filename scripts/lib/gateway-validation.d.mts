export interface GatewayChecksResult {
  checks: { name: string; passed: true }[];
  configurationHashes: Record<string, string>;
}
export function inspectVmGateway(
  resolved: unknown,
  base: unknown,
): { image: string; apiImage: string; targets: number[] };
export function runGatewayChecks(options: {
  docker(args: string[], timeout?: number): Promise<string>;
  compose(args: string[], timeout?: number): Promise<string>;
  config: {
    name: string;
    networks: { application: { name: string; internal: boolean } };
    services: {
      gateway: { image: string };
      api: { image: string; environment: Record<string, string> };
    };
  };
  project: string;
  directory: string;
  envFile: string;
}): Promise<GatewayChecksResult>;
