export const backendDeliveryPolicy: {
  schemaVersion: number;
  platform: string;
  scannerImage: string;
  scannerVersion: string;
  maximumScanAgeHours: number;
  blockedSeverities: string[];
};
export function fileDigest(path: string): Promise<string>;
export function classifyBackendFailure(error: unknown): {
  kind:
    | "verification"
    | "output-limit"
    | "process-unavailable"
    | "process-terminated"
    | "command-exit"
    | "invalid-json";
  exitCode?: number;
};
export const BACKEND_CANDIDATE_FILES: readonly string[];
export function verifyBackendCandidateFiles(
  candidate: { files: Record<string, string> },
  directory: string,
  options?: { recordsOnly?: boolean },
): Promise<void>;
export function inspectBackendImage(
  image: any,
  sourceSha: string,
): { id: string; platform: string };
export function backendArchiveConfigDigest(
  raw: string,
  image: any,
  sourceSha: string,
): string;
export function summarizeBackendScan(
  scan: any,
  configDigest: string,
  now?: number,
): any;
export function assertBackendPromotion(
  candidate: any,
  request: any,
): {
  target: string;
  imageId: string;
  execution: "not-performed";
};
export const backendRoot: string;
export const backendCandidateDirectory: string;
export function inspectBackendScanDatabase(
  metadata: any,
  now?: number,
): { version: number; updatedAt: string; downloadedAt: string };
export function inspectBackendPromotionSource(
  run: any,
  environment: any,
  expected: { repository: string; sourceSha: string; target: string },
): {
  runId: string;
  artifact: string;
  imageArtifact: string;
  environment: string;
};
