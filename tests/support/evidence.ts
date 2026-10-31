import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { buildProvenance } from "./build-provenance";
import type { ComparisonAttachment } from "../../packages/acceptance-metrics";
export type CaseResult = {
  id: string;
  status: string;
  comparison?: ComparisonAttachment;
  [key: string]: unknown;
};
export function completeCases(expected: string[], cases: CaseResult[]) {
  return (
    expected.length > 0 &&
    new Set(expected).size === expected.length &&
    cases.length === expected.length &&
    new Set(cases.map((c) => c.id)).size === expected.length &&
    cases.every((c) => c.status === "passed" && expected.includes(c.id))
  );
}
export async function writeEvidence(
  path: string,
  data: Record<string, unknown>,
) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + "\n");
}
export async function unchangedBuild(
  start: Awaited<ReturnType<typeof buildProvenance>>,
) {
  if (!start) return false;
  return (
    JSON.stringify(start) ===
    JSON.stringify(await buildProvenance(start.target))
  );
}
