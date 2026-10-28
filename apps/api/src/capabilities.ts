import type { KnowledgeStore } from "../../../packages/navigation-core/storage";
import type { SiteMemory } from "../../../packages/page-model";
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
