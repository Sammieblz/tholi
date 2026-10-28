export function initializeLocalEnvironment(options: {
  envFile: string;
  project?: string;
  ports?: Record<string, string | number>;
}): { envFile: string };
export function localStackArguments(options: {
  action: "up" | "down" | "status" | "logs" | "migrate" | "seed" | "reset";
  envFile?: string;
  project?: string;
  selectedProfiles?: string[];
  confirmDelete?: string;
}): string[];
