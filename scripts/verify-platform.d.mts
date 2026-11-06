export type PlatformEvidenceOptions = {
  full?: boolean;
  artifactFiles?: Record<string, string>;
  identity?: { runId: string };
};
export function matchesBrowserBackingScale(
  measurement: unknown,
  requestedScale: number,
): boolean;
export function validatePlatformReports(
  reports: unknown[],
  buildTargets: { chromium: string; firefox: string },
  options?: PlatformEvidenceOptions,
): { passed: boolean; targets: number; runId: string; casesPerTarget: number };
export function platformEvidence(
  buildTargets: { chromium: string; firefox: string },
  options?: PlatformEvidenceOptions,
): Promise<{
  passed: boolean;
  targets: number;
  runId: string;
  casesPerTarget: number;
}>;
