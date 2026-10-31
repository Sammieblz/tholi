import type { KnowledgeStore } from "../../../packages/navigation-core/storage";
import type { SiteMemory } from "../../../packages/page-model";
import type { NavigationObservation } from "../../../packages/navigation-core/contracts-navigation";
import type { ModelBudget, ModelUsage } from "./application/model-contracts";
import type {
  RecognitionInput,
  VisualObservation,
} from "../../../packages/vision/contracts";

export interface RuntimeResource {
  name: string;
  ready(): boolean | Promise<boolean>;
  stop(): void | Promise<void>;
  close(): void | Promise<void>;
}

/** Application-facing context; never contains HTTP credentials or browser authority. */
export interface ServiceRequestContext {
  readonly requestId: string;
  readonly deadlineAt: number;
  readonly signal: AbortSignal;
}

export interface NavigationRepository extends KnowledgeStore {
  mirror(site: SiteMemory): Promise<void>;
}

export interface LocalInference {
  infer(
    type: "plan" | "suggestions" | "reset",
    input: unknown,
    signal?: AbortSignal,
  ): Promise<unknown>;
}

/** Untrusted proposal boundary, separate from legacy local NLP/OCR and HTTP. */
export interface NavigationModel {
  infer(
    input: { observation: NavigationObservation; budget: ModelBudget },
    context: ServiceRequestContext,
  ): Promise<{ proposal: unknown; usage: ModelUsage }>;
}

export interface LocalWorkers extends LocalInference, RuntimeResource {
  recognize(
    input: RecognitionInput,
    signal: AbortSignal,
  ): Promise<VisualObservation>;
}

export interface PrivateCapabilities {
  repository: NavigationRepository;
  workers: LocalWorkers;
  resources: RuntimeResource[];
}
