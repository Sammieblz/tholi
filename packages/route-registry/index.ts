import { routeSchema, type Route } from "../route-schema";
import { demoRoute } from "../../routes/demo/cancellation";
import { billingRoute } from "../../routes/demo/billing";
import { allowedOrigin } from "../safety-policy";
export function createRegistry(packs: unknown[]) {
  const routes = packs.map((pack) => routeSchema.parse(pack));
  if (new Set(routes.map((r) => r.id)).size !== routes.length)
    throw new Error("Duplicate bundled route ID");
  // Consumers receive validated copies so sessions cannot mutate bundled route definitions.
  return {
    get(id: string, version?: string): Route | undefined {
      const route = routes.find(
        (r) => r.id === id && (!version || r.version === version),
      );
      return route ? routeSchema.parse(route) : undefined;
    },
    forOrigin(origin: string): Route[] {
      return routes
        .filter((r) => allowedOrigin(r, origin))
        .map((r) => routeSchema.parse(r));
    },
  };
}
export const routeRegistry = createRegistry([demoRoute, billingRoute]);
export type RoutePreview = Pick<
  Route,
  | "id"
  | "taskId"
  | "title"
  | "siteName"
  | "description"
  | "safetyNote"
  | "version"
  | "lastVerified"
  | "milestones"
  | "milestoneStates"
>;
export function previewRoute(route: Route): RoutePreview {
  const {
    id,
    taskId,
    title,
    siteName,
    description,
    safetyNote,
    version,
    lastVerified,
    milestones,
    milestoneStates,
  } = route;
  return {
    id,
    taskId,
    title,
    siteName,
    description,
    safetyNote,
    version,
    lastVerified,
    milestones,
    milestoneStates,
  };
}
