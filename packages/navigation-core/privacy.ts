import type {
  PageSnapshot,
  SavedTask,
  SiteMemory,
  ObservedTransition,
} from "../page-model";
import { hash } from "../page-model";
import { platformFor, interfaceVocabulary, workflowGuides } from "./guides";

export const privatePlatform = (origin: string) => !!platformFor(origin);
export const interfaceText = (text?: string) =>
  !!text && interfaceVocabulary.has(text.toLowerCase());
export function structuralObservation(page: PageSnapshot): PageSnapshot {
  const privateRoot =
    privatePlatform(page.origin) ||
    page.controls.some(
      (c) => c.retention === "session" && !c.reference?.frameId,
    );
  if (
    !privateRoot &&
    !page.controls.some(
      (c) => c.reference?.frameId || c.retention === "session",
    )
  )
    return page;
  return {
    ...page,
    path: privateRoot ? "/{context}" : page.path,
    controls: page.controls
      .filter(
        (c) =>
          (!privateRoot &&
            !c.reference?.frameId &&
            c.retention !== "session") ||
          interfaceText(c.label),
      )
      .map((c) =>
        !privateRoot && !c.reference?.frameId && c.retention !== "session"
          ? c
          : {
              ...c,
              description: undefined,
              context: interfaceText(c.context) ? c.context : "",
              group: interfaceText(c.group) ? c.group : "Interface",
              destination: undefined,
              navigationKey: undefined,
              options: undefined,
              range: undefined,
              structure: {
                headings:
                  c.structure?.headings.filter((h) => interfaceText(h.label)) ||
                  [],
                regions:
                  c.structure?.regions.filter((r) => interfaceText(r.name)) ||
                  [],
              },
              signature: hash(
                [c.role, c.kind, c.label.toLowerCase(), "structural"].join("|"),
              ),
              retention: "interface" as const,
              reference: undefined,
            },
      ),
    signals: undefined,
  };
}
export function structuralTransition(
  origin: string,
  transition?: ObservedTransition,
  sessionOnly = false,
) {
  if (!transition || (!privatePlatform(origin) && !sessionOnly))
    return transition;
  if (!interfaceText(transition.label)) return;
  // Signatures are opaque hashes; retain them so an observed edge can rebind to
  // fresh evidence. No historical document/control ID is an actionable target.
  return { ...transition };
}
export function parameterizedTask(task: SavedTask): SavedTask {
  if (
    task.retention !== "session" &&
    !privatePlatform(task.origin) &&
    !task.progress.some((p) => privatePlatform(p.origin))
  )
    return task;
  const guide =
    workflowGuides.find((g) => g.id === task.guideId) ||
    workflowGuides.find(
      (g) =>
        g.platform === platformFor(task.origin) &&
        g.intents.some((i) => task.goal.toLowerCase().includes(i)),
    );
  const goal =
    guide?.purpose ||
    (interfaceText(task.objective.purpose)
      ? task.objective.purpose
      : "Saved navigation route");
  return {
    ...task,
    goal,
    canonicalGoal: goal,
    objective: { purpose: goal },
    progress: task.progress.map((p) => ({
      ...p,
      label: interfaceText(p.label) ? p.label : "Choose requested item",
      signature: hash(
        p.kind + "|" + (interfaceText(p.label) ? p.label : "{item}"),
      ),
    })),
    planned: task.planned?.map((p) => ({
      ...p,
      label: interfaceText(p.label) ? p.label : "Choose requested item",
      signature: undefined,
    })),
    estimate: task.estimate
      ? {
          ...task.estimate,
          predictions: task.estimate.predictions.map((p) => ({
            ...p,
            label: interfaceText(p.label) ? p.label : "Choose requested item",
          })),
        }
      : undefined,
  };
}
export function structuralKnowledge(site: SiteMemory): SiteMemory {
  if (!privatePlatform(site.origin)) return site;
  const clean = (page: SiteMemory["pages"][number]) => ({
    ...page,
    path: "/{context}",
    controls: page.controls
      .filter((c) => interfaceText(c.label))
      .map((c) => ({
        ...c,
        description: undefined,
        context: interfaceText(c.context) ? c.context : "",
        group: "Interface",
        destination: undefined,
        options: undefined,
        structure: { headings: [], regions: [] },
        retention: "interface" as const,
        signature: hash(
          [c.role, c.kind, c.label.toLowerCase(), "structural"].join("|"),
        ),
      })),
  });
  return {
    ...site,
    pages: site.pages.map(clean),
    states: site.states?.map(clean),
    transitions: site.transitions
      .filter((t) => interfaceText(t.label))
      .map((t) => ({
        ...t,
        signature: hash(t.label.toLowerCase() + "|structural"),
      })),
  };
}
