import {
  type PageSnapshot,
  type SiteMemory,
  type ObservedTransition,
  type MemoryTransition,
  hash,
  savedTaskSchema,
  type SavedTask,
} from "../page-model";
const MAX_AGE = 90 * 86400000;
export function mergeObservation(
  previous: SiteMemory | undefined,
  page: PageSnapshot,
  observed?: ObservedTransition,
  now = Date.now(),
): SiteMemory {
  const site: SiteMemory = previous
    ? structuredClone(previous)
    : {
        schemaVersion: 1,
        origin: page.origin,
        version: 0,
        lastSeen: now,
        pages: [],
        templates: [],
        transitions: [],
      };
  const old = site.pages.find((p) => p.key === page.pageKey);
  const changed = !old || old.fingerprint !== page.fingerprint;
  const currentSignatures = new Set(page.controls.map((c) => c.signature));
  const controls = page.controls.map(
    ({ id, revealIds, inViewport, placement, navigationKey, ...c }) => ({
      ...c,
      lastSeen: now,
      active: true,
    }),
  );
  // A partial scan cannot prove that a control disappeared. Hidden controls are included in complete scans.
  for (const control of old?.controls || [])
    if (!currentSignatures.has(control.signature))
      controls.push({
        ...control,
        active: page.partial ? control.active : false,
      });
  site.pages = site.pages.filter(
    (p) => p.key !== page.pageKey && now - p.lastSeen < MAX_AGE,
  );
  site.pages.push({
    key: page.pageKey,
    path: page.path,
    stateKey: page.stateKey,
    language: page.language,
    templateKey: page.templateKey,
    fingerprint: page.fingerprint,
    version: (old?.version || 0) + Number(changed),
    lastSeen: now,
    controls: controls.slice(0, 800),
  });
  // Keep bounded state snapshots as well as the latest view of each page.
  // Menus and SPA screens share a pathname but form different graph vertices.
  site.states = [
    ...(site.states || []).filter(
      (p) => p.stateKey !== page.stateKey && now - p.lastSeen < MAX_AGE,
    ),
    structuredClone(site.pages.at(-1)!),
  ]
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, 120);
  let stateBudget = 8000;
  for (const state of site.states) {
    state.controls = state.controls.slice(0, stateBudget);
    stateBudget -= state.controls.length;
  }
  site.pages = site.pages.sort((a, b) => b.lastSeen - a.lastSeen).slice(0, 100);
  let controlBudget = 5000;
  for (const saved of site.pages) {
    saved.controls = saved.controls.slice(0, controlBudget);
    controlBudget -= saved.controls.length;
  }
  const template = site.templates.find((t) => t.key === page.templateKey);
  const structure = hash(
    page.controls
      .filter((c) => c.kind !== "section" && c.group !== "Page links")
      .map((c) => c.signature)
      .sort()
      .join("|"),
  );
  if (template) {
    if (template.fingerprint !== structure) template.version++;
    template.fingerprint = structure;
    template.lastSeen = now;
  } else
    site.templates.push({
      key: page.templateKey,
      fingerprint: structure,
      version: 1,
      lastSeen: now,
    });
  site.templates = site.templates
    .filter((t) => now - t.lastSeen < MAX_AGE)
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, 30);
  if (!page.partial)
    for (const edge of site.transitions)
      if (
        edge.from.startsWith(page.pageKey + ":") &&
        !currentSignatures.has(edge.signature)
      )
        edge.active = false;
  const upsert = (edge: MemoryTransition) => {
    const existing = site.transitions.find(
      (t) =>
        t.from === edge.from &&
        t.to === edge.to &&
        t.signature === edge.signature,
    );
    if (existing) {
      if (edge.evidence === "observed" || existing.evidence !== "observed") {
        const samples = existing.samples || 0,
          mean = existing.meanMs;
        Object.assign(existing, edge);
        if (edge.evidence === "observed" && edge.meanMs !== undefined) {
          existing.samples = samples + 1;
          existing.meanMs =
            ((mean || 0) * samples + edge.meanMs) / existing.samples;
        }
      }
    } else site.transitions.push(edge);
  };
  for (const c of page.controls)
    if (
      c.destination &&
      c.kind === "navigation" &&
      c.destination.origin === page.origin
    )
      upsert({
        from: page.stateKey,
        to: c.destination.key,
        signature: c.signature,
        label: c.label,
        evidence: "inferred",
        lastVerified: now,
        active: true,
      });
  if (observed && observed.from !== observed.to)
    upsert({
      ...observed,
      evidence: "observed",
      lastVerified: now,
      active: true,
      samples: observed.durationMs === undefined ? undefined : 1,
      meanMs: observed.durationMs,
    });
  site.transitions = site.transitions
    .filter((t) => now - t.lastVerified < MAX_AGE)
    .sort(
      (a, b) =>
        Number(b.evidence === "observed") - Number(a.evidence === "observed") ||
        b.lastVerified - a.lastVerified,
    )
    .slice(0, 400);
  site.version += Number(changed || !!observed);
  site.lastSeen = now;
  return site;
}
export function memorySummary(site?: SiteMemory) {
  return {
    pages: site?.pages.length || 0,
    templates: site?.templates.length || 0,
    observedTransitions:
      site?.transitions.filter((t) => t.active && t.evidence === "observed")
        .length || 0,
    version: site?.version || 0,
  };
}
export type SiteMemoryStore =
  import("../navigation-core/storage").KnowledgeStore;
// This database belongs to the extension origin, never to a website content script.
export class IndexedDBSiteMemory implements SiteMemoryStore {
  private database?: Promise<IDBDatabase>;
  private open() {
    return (this.database ||= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("navigator-site-memory", 3);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("sites"))
          request.result.createObjectStore("sites", { keyPath: "origin" });
        if (!request.result.objectStoreNames.contains("tasks"))
          request.result.createObjectStore("tasks", { keyPath: "id" });
        if (!request.result.objectStoreNames.contains("embeddings"))
          request.result.createObjectStore("embeddings", { keyPath: "key" });
        if (!request.result.objectStoreNames.contains("indexes"))
          request.result.createObjectStore("indexes", { keyPath: "origin" });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          this.database = undefined;
        };
        resolve(db);
      };
      request.onerror = () => {
        this.database = undefined;
        reject(request.error);
      };
      request.onblocked = () => {
        this.database = undefined;
        reject(
          new Error(
            "Site memory upgrade is blocked by another extension page.",
          ),
        );
      };
    }));
  }
  async get(origin: string): Promise<SiteMemory | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("sites", "readwrite"),
        store = transaction.objectStore("sites"),
        request = store.get(origin);
      let result: SiteMemory | undefined;
      request.onsuccess = () => {
        const site = request.result as SiteMemory | undefined,
          now = Date.now();
        if (!site) return;
        if (site.schemaVersion !== 1 || now - site.lastSeen > MAX_AGE) {
          store.delete(origin);
          return;
        }
        const serialized = JSON.stringify(site);
        site.pages = site.pages
          .filter((p) => now - p.lastSeen < MAX_AGE)
          .map((p) => ({
            ...p,
            controls: p.controls.filter((c) => now - c.lastSeen < MAX_AGE),
          }));
        site.templates = site.templates.filter(
          (t) => now - t.lastSeen < MAX_AGE,
        );
        site.transitions = site.transitions.filter(
          (t) => now - t.lastVerified < MAX_AGE,
        );
        site.states = site.states
          ?.filter((p) => now - p.lastSeen < MAX_AGE)
          .map((p) => ({
            ...p,
            controls: p.controls.filter((c) => now - c.lastSeen < MAX_AGE),
          }));
        if (serialized !== JSON.stringify(site)) store.put(site);
        result = site;
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }
  async observe(page: PageSnapshot, transition?: ObservedTransition) {
    const db = await this.open();
    return new Promise<SiteMemory>((resolve, reject) => {
      const transaction = db.transaction("sites", "readwrite"),
        store = transaction.objectStore("sites");
      let result: SiteMemory;
      const request = store.get(page.origin);
      request.onsuccess = () => {
        result = mergeObservation(request.result, page, transition);
        store.put(result);
      };
      const all = store.getAll();
      all.onsuccess = () => {
        const sites = (all.result as SiteMemory[])
          .filter((s) => s.origin !== page.origin)
          .sort((a, b) => b.lastSeen - a.lastSeen);
        for (const site of sites.slice(49)) store.delete(site.origin);
        for (const site of sites)
          if (Date.now() - site.lastSeen > MAX_AGE) store.delete(site.origin);
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(
          transaction.error || new Error("Site memory could not be saved."),
        );
    });
  }
  async forget(origin: string) {
    await this.remove(origin);
  }
  async clear() {
    await this.remove();
  }
  async tasks(origin: string): Promise<SavedTask[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("tasks", "readwrite"),
        store = tx.objectStore("tasks"),
        request = store.getAll();
      let result: SavedTask[] = [];
      request.onsuccess = () => {
        for (const raw of request.result) {
          const parsed = savedTaskSchema.safeParse(raw);
          if (!parsed.success || Date.now() - parsed.data.updatedAt > MAX_AGE) {
            store.delete(raw.id);
            continue;
          }
          if (parsed.data.origin === origin) result.push(parsed.data);
        }
        result.sort((a, b) => b.updatedAt - a.updatedAt);
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  async saveTask(task: SavedTask) {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("tasks", "readwrite"),
        store = tx.objectStore("tasks");
      store.put(savedTaskSchema.parse(task));
      const request = store.getAll();
      request.onsuccess = () => {
        const tasks = (request.result as SavedTask[]).sort(
          (a, b) => b.updatedAt - a.updatedAt,
        );
        for (const old of tasks.slice(100)) store.delete(old.id);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  async deleteTask(id: string) {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("tasks", "readwrite");
      tx.objectStore("tasks").delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  private async remove(origin?: string) {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(["sites", "tasks"], "readwrite");
      const store = transaction.objectStore("sites");
      origin ? store.delete(origin) : store.clear();
      const tasks = transaction.objectStore("tasks");
      if (!origin) tasks.clear();
      else {
        const request = tasks.getAll();
        request.onsuccess = () => {
          for (const task of request.result as SavedTask[])
            if (
              task.origin === origin ||
              task.progress.some((p) => p.origin === origin)
            )
              tasks.delete(task.id);
        };
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }
}
