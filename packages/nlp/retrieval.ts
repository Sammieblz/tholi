import type { PageControl, PageSnapshot } from "../page-model";
import type { TaskIntent } from "../navigation-core/contracts";
import { sanitizeText } from "../privacy-redaction";
import type { Embedder } from "./model";
import { MODEL_REVISION, DIMENSIONS } from "./constants";
import { goalScore } from "../goal-planner";
export interface CachedEmbedding {
  key: string;
  revision: string;
  vector: number[];
  usedAt: number;
}
export interface IndexEntry {
  signature: string;
  hash: string;
  text: string;
}
export interface DerivedStore {
  getEmbedding(key: string): Promise<CachedEmbedding | undefined>;
  putEmbedding(value: CachedEmbedding): Promise<void>;
  putIndex(origin: string, entries: IndexEntry[]): Promise<void>;
  clearDerived(origin?: string): Promise<void>;
}
export class MemoryDerivedStore implements DerivedStore {
  embeddings = new Map<string, CachedEmbedding>();
  indexes = new Map<string, IndexEntry[]>();
  async getEmbedding(key: string) {
    return this.embeddings.get(key);
  }
  async putEmbedding(value: CachedEmbedding) {
    this.embeddings.delete(value.key);
    this.embeddings.set(value.key, value);
    while (this.embeddings.size > 10000)
      this.embeddings.delete(this.embeddings.keys().next().value!);
  }
  async putIndex(origin: string, entries: IndexEntry[]) {
    const merged = new Map(
      (this.indexes.get(origin) || []).map((e) => [e.signature, e]),
    );
    for (const entry of entries) {
      merged.delete(entry.signature);
      merged.set(entry.signature, entry);
    }
    this.indexes.set(origin, [...merged.values()].slice(-5000));
  }
  async clearDerived(origin?: string) {
    if (origin) this.indexes.delete(origin);
    else this.indexes.clear();
    this.embeddings.clear();
  }
}
const stop = new Set(
  "a an the to of on in this that my me please i want can you for how could would like help do is be it where show find go open change set switch".split(
    " ",
  ),
);
export const words = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter((w) => !stop.has(w))
    .map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w)) || [];
export function semanticText(
  control: PageControl,
  page?: PageSnapshot,
): string {
  const reveal = control.revealIds
    .map((id) => page?.controls.find((c) => c.id === id)?.label)
    .filter(Boolean);
  return [
    control.label,
    control.description,
    control.role,
    control.context,
    control.group,
    control.form?.authentication,
    control.targetLanguage,
    control.destination?.path,
    ...(control.options?.map((option) => option.label) || []),
    ...(control.structure?.headings.map((h) => h.label) || []),
    ...(control.structure?.regions.map((r) => r.name) || []),
    ...reveal,
  ]
    .filter(Boolean)
    .map((v) => sanitizeText(v!))
    .join(" | ");
}
export async function semanticHash(text: string) {
  const bytes = new TextEncoder().encode(text);
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
}
export const cosine = (a: number[], b: number[]) =>
  a.reduce((sum, v, i) => sum + v * (b[i] || 0), 0);
export function bm25(query: string, documents: string[]): number[] {
  const tokens = documents.map(words),
    avg = tokens.reduce((s, d) => s + d.length, 0) / Math.max(1, tokens.length);
  const q = [...new Set(words(query))];
  return tokens.map((d) =>
    q.reduce((score, term) => {
      const df = tokens.filter((v) => v.includes(term)).length,
        tf = d.filter((v) => v === term).length;
      return (
        score +
        (Math.log(1 + (tokens.length - df + 0.5) / (df + 0.5)) * tf * 2.2) /
          (tf + 1.2 * (0.25 + (0.75 * d.length) / Math.max(avg, 1)))
      );
    }, 0),
  );
}
export class SemanticIndex {
  activity = { embedded: 0, cacheHits: 0 };
  private hot = new Map<string, number[]>();
  private hashes = new Map<string, string>();
  private remember(text: string, vector: number[]) {
    this.hot.delete(text);
    this.hot.set(text, vector);
    while (this.hot.size > 10000)
      this.hot.delete(this.hot.keys().next().value!);
  }
  constructor(
    private embedder: Embedder,
    private storage: DerivedStore,
  ) {}
  async vector(text: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const hot = this.hot.get(text);
    if (hot) {
      this.activity.cacheHits++;
      return hot;
    }
    const key = MODEL_REVISION + ":" + (await semanticHash(text)),
      cached = await this.storage.getEmbedding(key);
    if (
      cached?.revision === MODEL_REVISION &&
      cached.vector.length === DIMENSIONS &&
      cached.vector.every(Number.isFinite)
    ) {
      this.activity.cacheHits++;
      this.remember(text, cached.vector);
      return cached.vector;
    }
    const [vector] = await this.embedder.embed([text], signal);
    this.activity.embedded++;
    await this.storage.putEmbedding({
      key,
      revision: MODEL_REVISION,
      vector,
      usedAt: Date.now(),
    });
    this.remember(text, vector);
    return vector;
  }
  async rank(page: PageSnapshot, task: TaskIntent, signal?: AbortSignal) {
    const texts = page.controls.map((c) => semanticText(c, page));
    const query = [task.target, ...task.qualifiers].join(" ");
    const lexical = bm25(query, texts),
      max = Math.max(1, ...lexical);
    const queryVector = await this.vector(query, signal);
    const entries: IndexEntry[] = [];
    const candidates = [];
    // Semantic/state cache keys deliberately omit visibility, risk and checked state.
    // These fields always come from this fresh observation.
    for (let i = 0; i < page.controls.length; i++) {
      const control = page.controls[i],
        text = texts[i];
      const vector = await this.vector(text, signal),
        hash = this.hashes.get(text) || (await semanticHash(text));
      this.hashes.set(text, hash);
      while (this.hashes.size > 10000)
        this.hashes.delete(this.hashes.keys().next().value!);
      entries.push({ signature: control.signature, hash, text });
      const semantic = cosine(queryVector, vector),
        lex = lexical[i] / max;
      const direct = words(task.target).every((w) =>
        words(control.label + " " + (control.description || "")).includes(w),
      );
      const excluded = task.exclusions.some((e) =>
        words(e).some((w) => words(text).includes(w)),
      );
      const qualified = task.qualifiers.every(
        (q) =>
          words(q).every((w) => words(text).includes(w)) ||
          goalScore(q, control) >= 0.7,
      );
      const scoped =
        task.scope === "any" || !control.scope || task.scope === control.scope;
      candidates.push({
        control,
        lexical: lex,
        semantic,
        score: direct ? 1 : 0.55 * lex + 0.45 * Math.max(0, semantic),
        eligible: !excluded && qualified && scoped,
        direct,
      });
    }
    await this.storage.putIndex(page.origin, entries);
    return candidates.sort((a, b) => b.score - a.score);
  }
  async dispose() {
    await this.embedder.dispose();
  }
  invalidateCache() {
    this.hot.clear();
    this.hashes.clear();
  }
}
