export function runObservabilityChecks(options: {
  compose(args: string[], timeout?: number): Promise<string>;
  runPostgresImage(mode?: string[]): Promise<any>;
  sentinel: string;
}): Promise<{
  passed: boolean;
  actualFailedProvider: boolean;
  actualRetriedWorker: boolean;
  attempts: number;
  inspectedRecords: number;
  privacySentinelAbsent: boolean;
  collectorSha256: string;
  metricsSha256: string;
  noRawRecordsRetained: boolean;
}>;
