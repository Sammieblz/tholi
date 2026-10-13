import { DatabaseSync } from "node:sqlite";
import type {
  CachedEmbedding,
  DerivedStore,
  IndexEntry,
} from "../../../packages/nlp/retrieval";
import type {
  PageSnapshot,
  ObservedTransition,
  SiteMemory,
  SavedTask,
} from "../../../packages/page-model";
import { savedTaskSchema } from "../../../packages/page-model";
import { mergeObservation } from "../../../packages/site-memory";
import { MODEL_REVISION } from "../../../packages/nlp/constants";
import type { KnowledgeStore } from "../../../packages/navigation-core/storage";
import {
  structuralObservation,
  structuralTransition,
  structuralKnowledge,
  parameterizedTask,
  privatePlatform,
} from "../../../packages/navigation-core/privacy";
export class SqliteStorage implements DerivedStore, KnowledgeStore {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS sites(origin TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS routes(id TEXT PRIMARY KEY, origin TEXT NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS embeddings(key TEXT PRIMARY KEY, revision TEXT NOT NULL, vector TEXT NOT NULL, used_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS embeddings_usage ON embeddings(used_at); CREATE TABLE IF NOT EXISTS indexes(origin TEXT PRIMARY KEY, data TEXT NOT NULL);",
    );
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
    );
    const revision = this.db
      .prepare("SELECT value FROM metadata WHERE key='model_revision'")
      .get();
    if (revision?.value !== MODEL_REVISION) {
      this.db.exec("DELETE FROM embeddings; DELETE FROM indexes");
      this.db
        .prepare("INSERT OR REPLACE INTO metadata VALUES('model_revision',?)")
        .run(MODEL_REVISION);
    }
    const privacy = this.db
      .prepare("SELECT value FROM metadata WHERE key='privacy_version'")
      .get();
    if (privacy?.value !== "4") {
      for (const row of this.db
        .prepare("SELECT origin,data FROM sites")
        .all()) {
        if (privatePlatform(String(row.origin))) {
          this.db
            .prepare("UPDATE sites SET data=? WHERE origin=?")
            .run(
              JSON.stringify(structuralKnowledge(JSON.parse(String(row.data)))),
              row.origin,
            );
          this.db.prepare("DELETE FROM indexes WHERE origin=?").run(row.origin);
        }
      }
      for (const row of this.db.prepare("SELECT id,data FROM routes").all()) {
        this.db
          .prepare("UPDATE routes SET data=? WHERE id=?")
          .run(
            JSON.stringify(
              parameterizedTask(
                savedTaskSchema.parse(JSON.parse(String(row.data))),
              ),
            ),
            row.id,
          );
      }
      this.db.exec(
        "DELETE FROM embeddings; INSERT OR REPLACE INTO metadata VALUES('privacy_version','4')",
      );
    }
  }
  async getEmbedding(key: string) {
    const row = this.db
      .prepare("SELECT * FROM embeddings WHERE key=?")
      .get(key);
    return row
      ? ({
          key,
          revision: String(row.revision),
          vector: JSON.parse(String(row.vector)),
          usedAt: Number(row.used_at),
        } as CachedEmbedding)
      : undefined;
  }
  async putEmbedding(value: CachedEmbedding) {
    this.db
      .prepare("INSERT OR REPLACE INTO embeddings VALUES(?,?,?,?)")
      .run(
        value.key,
        value.revision,
        JSON.stringify(value.vector),
        value.usedAt,
      );
    this.db.exec(
      "DELETE FROM embeddings WHERE key IN (SELECT key FROM embeddings ORDER BY used_at DESC LIMIT -1 OFFSET 10000)",
    );
  }
  async putIndex(origin: string, entries: IndexEntry[]) {
    const row = this.db
      .prepare("SELECT data FROM indexes WHERE origin=?")
      .get(origin);
    const merged = new Map<string, IndexEntry>(
      (row ? JSON.parse(String(row.data)) : []).map((e: IndexEntry) => [
        e.signature,
        e,
      ]),
    );
    for (const entry of entries) {
      merged.delete(entry.signature);
      merged.set(entry.signature, entry);
    }
    this.db
      .prepare("INSERT OR REPLACE INTO indexes VALUES(?,?)")
      .run(origin, JSON.stringify([...merged.values()].slice(-5000)));
  }
  async clearDerived(origin?: string) {
    origin
      ? this.db.prepare("DELETE FROM indexes WHERE origin=?").run(origin)
      : this.db.exec("DELETE FROM indexes");
    this.db.exec("DELETE FROM embeddings");
  }
  async get(origin: string): Promise<SiteMemory | undefined> {
    const row = this.db
      .prepare("SELECT data FROM sites WHERE origin=?")
      .get(origin);
    return row ? JSON.parse(String(row.data)) : undefined;
  }
  async observe(page: PageSnapshot, transition?: ObservedTransition) {
    transition = structuralTransition(
      page.origin,
      transition,
      page.controls.some(
        (c) => c.retention === "session" || c.reference?.frameId,
      ),
    );
    page = structuralObservation(page);
    const site = mergeObservation(
      await this.get(page.origin),
      page,
      transition,
    );
    this.db
      .prepare("INSERT OR REPLACE INTO sites VALUES(?,?)")
      .run(page.origin, JSON.stringify(site));
    return site;
  }
  async mirror(site: SiteMemory) {
    site = structuralKnowledge(site);
    this.db
      .prepare("INSERT OR REPLACE INTO sites VALUES(?,?)")
      .run(site.origin, JSON.stringify(site));
    this.prune();
  }
  private prune() {
    const cutoff = Date.now() - 90 * 86400000;
    const sites = this.db
      .prepare("SELECT origin,data FROM sites")
      .all()
      .map((row) => ({
        origin: String(row.origin),
        site: JSON.parse(String(row.data)) as SiteMemory,
      }))
      .sort((a, b) => b.site.lastSeen - a.site.lastSeen);
    for (let i = 0; i < sites.length; i++)
      if (i >= 50 || sites[i].site.lastSeen < cutoff) {
        this.db
          .prepare("DELETE FROM sites WHERE origin=?")
          .run(sites[i].origin);
        this.db
          .prepare("DELETE FROM indexes WHERE origin=?")
          .run(sites[i].origin);
      }
    const routes = this.db
      .prepare("SELECT id,data FROM routes")
      .all()
      .map((row) => ({
        id: String(row.id),
        task: JSON.parse(String(row.data)) as SavedTask,
      }))
      .sort((a, b) => b.task.updatedAt - a.task.updatedAt);
    for (let i = 0; i < routes.length; i++)
      if (i >= 100 || routes[i].task.updatedAt < cutoff)
        this.db.prepare("DELETE FROM routes WHERE id=?").run(routes[i].id);
  }
  async tasks(origin: string): Promise<SavedTask[]> {
    return this.db
      .prepare("SELECT data FROM routes WHERE origin=?")
      .all(origin)
      .map((row) => savedTaskSchema.parse(JSON.parse(String(row.data))));
  }
  async saveTask(task: SavedTask) {
    task = parameterizedTask(task);
    task = savedTaskSchema.parse(task);
    this.db
      .prepare("INSERT OR REPLACE INTO routes VALUES(?,?,?)")
      .run(task.id, task.origin, JSON.stringify(task));
    this.prune();
  }
  async deleteTask(id: string) {
    this.db.prepare("DELETE FROM routes WHERE id=?").run(id);
  }
  async forget(origin: string) {
    this.db.prepare("DELETE FROM sites WHERE origin=?").run(origin);
    for (const row of this.db.prepare("SELECT id, data FROM routes").all()) {
      const task = JSON.parse(String(row.data)) as SavedTask;
      if (
        task.origin === origin ||
        task.progress.some((p) => p.origin === origin)
      )
        await this.deleteTask(String(row.id));
    }
    await this.clearDerived(origin);
  }
  async clear() {
    this.db.exec("DELETE FROM sites; DELETE FROM routes");
    await this.clearDerived();
  }
  close() {
    this.db.close();
  }
}
