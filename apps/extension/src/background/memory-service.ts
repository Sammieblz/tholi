import { api } from "../platform/api";
import type { PinnedSession } from "../../../../packages/route-registry/session";
import {
  saveTask,
  taskKey,
} from "../../../../packages/goal-planner/task-journey";
import { parameterizedTask } from "../../../../packages/navigation-core/privacy";
import {
  hash,
  transitionEvidenceSchema,
  type SavedTask,
  type SiteMemory,
} from "../../../../packages/page-model/index";
import { BackgroundMemory } from "../../../../packages/site-memory/background";
import {
  IndexedDBSiteMemory,
  memorySummary,
} from "../../../../packages/site-memory/index";
import { mirrorRoute } from "../platform/backend-client";

interface Context {
  knownSites: Map<string, SiteMemory | undefined>;
  knownTasks: Map<string, SavedTask[]>;
  memoryJobs: BackgroundMemory;
  memory: IndexedDBSiteMemory;
  session: PinnedSession | undefined;
  live: () => boolean;
  lastObservation: string;
}

export function createMemoryService(context: Context) {
  function cacheMemory(
    origin: string,
    site: SiteMemory | undefined,
    tasks: SavedTask[],
  ) {
    context.knownSites.set(origin, site);
    context.knownTasks.set(origin, tasks);
    while (context.knownSites.size > 50) {
      const oldest = context.knownSites.keys().next().value!;
      context.knownSites.delete(oldest);
      context.knownTasks.delete(oldest);
    }
  }

  function refreshMemory(origin: string) {
    context.memoryJobs.schedule("read:" + origin, async () => {
      const site = await context.memory.get(origin);
      const tasks = await context.memory.tasks(origin);
      cacheMemory(origin, site, tasks);
    });
  }

  async function remember(observed?: unknown) {
    if (!context.session?.view?.page || !context.live()) return;
    const page = context.session.view.page,
      evidence = transitionEvidenceSchema.safeParse(observed);
    const key =
      context.session.documentId +
      ":" +
      page.stateKey +
      ":" +
      (context.session.view.journey
        ? context.session.view.journey.id +
          ":" +
          context.session.view.journey.progress.length +
          ":" +
          context.session.view.journey.status
        : "") +
      ":" +
      hash(JSON.stringify(context.session.view.goalPlan) || "");
    if (context.lastObservation === key && !evidence.success) return;
    context.lastObservation = key;
    const pinned = context.session;
    const snapshot = structuredClone({
      page,
      journey: context.session.view.journey,
      plan: context.session.view.goalPlan,
      documentId: context.session.documentId,
      evidence: evidence.success ? evidence.data : undefined,
    });
    // Ordinary updates replace queued snapshots; verified edges have their own key.
    const jobKey =
      pinned.sessionId +
      ":" +
      page.pageKey +
      (snapshot.evidence
        ? ":edge:" + hash(JSON.stringify(snapshot.evidence))
        : "");
    context.memoryJobs.schedule(jobKey, async () => {
      try {
        const site = await context.memory.observe(
          snapshot.page,
          snapshot.evidence,
        );
        const journey = snapshot.journey;
        const tasks = await context.memory.tasks(page.origin);
        let savedTask;
        if (journey) {
          savedTask = tasks.find(
            (t) => t.id === (journey.savedRouteId || taskKey(journey)),
          );
          // A draft does not replace a previously successful route's observations.
          if (
            !pinned.forgottenTaskIds?.includes(taskKey(journey)) &&
            (!savedTask?.completed || journey.status === "completed")
          ) {
            const task = parameterizedTask(
              saveTask(journey, snapshot.page, snapshot.plan),
            );
            await context.memory.saveTask(task);
            await mirrorRoute(task).catch(() => {});
            const existing = tasks.findIndex((t) => t.id === task.id);
            if (existing >= 0) tasks.splice(existing, 1);
            tasks.unshift(task);
          }
        }
        cacheMemory(page.origin, site, tasks.slice(0, 100));
        if (
          context.session !== pinned ||
          !context.session.view ||
          context.session.documentId !== snapshot.documentId
        )
          return;
        context.session.view.memory = memorySummary(site);
        context.session.view.memoryError = undefined;
        // Late persistence must not replace a newer task's saved-route context.
        if (context.session.view.journey?.id !== journey?.id)
          savedTask = undefined;
        await api.tabs
          .sendMessage(context.session.tabId, {
            type: "UPDATE_MEMORY",
            sessionId: context.session.sessionId,
            memory: site,
            savedTask,
          })
          .catch(() => {});
      } catch {
        if (context.session === pinned && context.session.view)
          context.session.view.memoryError =
            "Site memory could not be saved. Live guidance remains available.";
        if (context.lastObservation === key) context.lastObservation = "";
      }
    });
  }
  return { cacheMemory, refreshMemory, remember };
}
