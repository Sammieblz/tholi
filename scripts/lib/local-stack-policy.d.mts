export interface LocalStackInspection {
  fingerprint: string;
  services: string[];
  images: Record<string, string>;
  ports: { service: string; host: string; published: number; target: number }[];
  networks: string[];
}
export function inspectLocalStack(config: unknown): LocalStackInspection;
export function assertOwnedSmokeProject(
  project: string,
  allocatedProject: string,
): void;
