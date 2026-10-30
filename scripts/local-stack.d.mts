export function initializeLocalEnvironment(options: {
  envFile: string;
  project?: string;
  ports?: Record<string, string | number>;
  upgradeIdentity?: boolean;
}): { envFile: string };
export interface LocalStackOptions {
  action: "up" | "down" | "status" | "logs" | "migrate" | "seed" | "reset";
  envFile?: string;
  project?: string;
  selectedProfiles?: string[];
  confirmDelete?: string;
}
export function localStackArguments(options: LocalStackOptions): string[];
export function localStackCommands(options: LocalStackOptions): string[][];
