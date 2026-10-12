import type {
  PageSnapshot,
  SiteMemory,
  ObservedTransition,
  SavedTask,
} from "../page-model";
export type {
  DerivedStore,
  CachedEmbedding,
  IndexEntry,
} from "../nlp/retrieval";
export interface KnowledgeStore {
  get(origin: string): Promise<SiteMemory | undefined>;
  observe(
    page: PageSnapshot,
    transition?: ObservedTransition,
  ): Promise<SiteMemory>;
  tasks(origin: string): Promise<SavedTask[]>;
  saveTask(task: SavedTask): Promise<void>;
  deleteTask(id: string): Promise<void>;
  forget(origin: string): Promise<void>;
  clear(): Promise<void>;
}
