import { hash } from "../page-model";
import type { OutcomeEvidence } from "./workflow-contracts";
export const signalIdentity = (s: OutcomeEvidence) =>
  hash(s.subject + "|" + s.text + "|" + (s.identity || ""));
