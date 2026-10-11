import { z } from "zod";
import { sessionViewSchema } from "../route-schema";
import { routeRegistry } from "./index";
import { LIVE_ROUTE_ID, LIVE_VERSION, supportsLiveUrl } from "../page-model";
export const sessionSchema = z
  .object({
    sessionId: z.string().uuid(),
    tabId: z.number().int().nonnegative(),
    routeId: z.string(),
    routeVersion: z.string(),
    documentId: z.string().optional(),
    navigationPending: z.boolean().optional(),
    origin: z.string().optional(),
    pendingNavigation: z
      .object({
        from: z.string().max(100),
        signature: z.string().max(100),
        label: z.string().max(160),
        destinationKey: z.string().max(100),
        navigationKey: z.string().max(100),
        origin: z.string().max(300),
      })
      .strict()
      .optional(),
    view: sessionViewSchema.optional(),
  })
  .strict();
export type PinnedSession = z.infer<typeof sessionSchema>;
export function validPinnedView(session: PinnedSession, view: unknown) {
  const parsed = sessionViewSchema.safeParse(view),
    route = routeRegistry.get(session.routeId, session.routeVersion);
  if (
    !parsed.success ||
    (!route &&
      !(
        session.routeId === LIVE_ROUTE_ID &&
        session.routeVersion === LIVE_VERSION &&
        supportsLiveUrl(session.origin || "")
      )) ||
    parsed.data.routeId !== session.routeId ||
    parsed.data.routeVersion !== session.routeVersion
  )
    return undefined;
  if (session.routeId === LIVE_ROUTE_ID) {
    const data = parsed.data;
    if (
      data.diagnostics ||
      (data.page && data.page.origin !== session.origin) ||
      (data.stateId &&
        !["choosing", "guiding", "verified"].includes(data.stateId)) ||
      data.history.some(
        (id) => !["choosing", "guiding", "verified"].includes(id),
      )
    )
      return undefined;
    if (
      new Set(data.controls?.map((c) => c.id)).size !==
      (data.controls?.length || 0)
    )
      return undefined;
    if (
      data.selectedControlId &&
      !data.controls?.some((c) => c.id === data.selectedControlId)
    )
      return undefined;
    if (
      data.page &&
      (new Set(data.page.controls.map((c) => c.id)).size !==
        data.page.controls.length ||
        data.controls?.some(
          (c) =>
            !data.page!.controls.some(
              (p) =>
                p.id === c.id &&
                p.signature === c.signature &&
                p.visible &&
                p.enabled,
            ),
        ))
    )
      return undefined;
    return data;
  }
  if (!route) return undefined;
  const ids = new Set(route.states.map((s) => s.id));
  if (
    parsed.data.controls ||
    parsed.data.selectedControlId ||
    parsed.data.page ||
    parsed.data.goalPlan
  )
    return undefined;
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
  if (
    !routeRegistry.get(parsed.data.routeId, parsed.data.routeVersion) &&
    !(
      parsed.data.routeId === LIVE_ROUTE_ID &&
      parsed.data.routeVersion === LIVE_VERSION &&
      supportsLiveUrl(parsed.data.origin || "")
    )
  )
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
