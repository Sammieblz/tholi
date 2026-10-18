export function digest(files: Record<string, string>): string;
export function validationIdentity(): {
  tier: string;
  runId: string;
  selection: string;
};
export function requireFullEvidence(
  report: any,
  files: Record<string, string>,
  identity?: { runId: string },
  target?: "chromium" | "firefox",
): any;
