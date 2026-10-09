import { z } from "zod";
import { sessionViewSchema } from "../route-schema";
import { routeRegistry } from "./index";
export const sessionSchema = z
  .object({
    sessionId: z.string().uuid(),
    tabId: z.number().int().nonnegative(),
    routeId: z.string(),
    routeVersion: z.string(),
    view: sessionViewSchema.optional(),
  })
  .strict();
export type PinnedSession = z.infer<typeof sessionSchema>;
export function validPinnedView(session: PinnedSession, view: unknown) {
  const parsed = sessionViewSchema.safeParse(view),
    route = routeRegistry.get(session.routeId, session.routeVersion);
  if (
    !parsed.success ||
    !route ||
    parsed.data.routeId !== session.routeId ||
    parsed.data.routeVersion !== session.routeVersion
  )
    return undefined;
  const ids = new Set(route.states.map((s) => s.id));
  if (
    (parsed.data.stateId && !ids.has(parsed.data.stateId)) ||
    parsed.data.history.some((id) => !ids.has(id))
  )
    return undefined;
  const d = parsed.data.diagnostics;
  const transitions = new Set(route.transitions.map((t) => t.id));
  if (
    d &&
    ((d.localization?.stateId && !ids.has(d.localization.stateId)) ||
      d.localization?.scores.some((s) => !ids.has(s.id)) ||
      (d.transitionId && !transitions.has(d.transitionId)) ||
      d.expected.some((id) => !ids.has(id)) ||
      d.transitions.some(
        (t) =>
          !transitions.has(t.transitionId) ||
          !ids.has(t.from) ||
          t.expected.some((id) => !ids.has(id)) ||
          (t.observed && !ids.has(t.observed)),
      ))
  )
    return undefined;
  return parsed.data;
}
export function restoreSession(value: unknown): PinnedSession | undefined {
  const parsed = sessionSchema.safeParse(value);
  if (!parsed.success) return undefined;
  if (!routeRegistry.get(parsed.data.routeId, parsed.data.routeVersion))
    return undefined;
  if (parsed.data.view && !validPinnedView(parsed.data, parsed.data.view))
    return undefined;
  return parsed.data;
}
export function sessionLocked(session?: {
  sessionId: string;
  view?: { status: string };
}): boolean {
  return (
    !!session &&
    (!session.view ||
      !["stopped", "boundary", "completed"].includes(session.view.status))
  );
}
