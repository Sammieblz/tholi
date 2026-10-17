import { z } from "zod";

export const surfacePresentationSchema = z
  .object({
    sessionId: z.string().uuid(),
    surface: z.enum(["sidebar", "widget"]),
    visibility: z.enum(["expanded", "launcher", "hidden"]),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export type SurfacePresentation = z.infer<typeof surfacePresentationSchema>;

export function initialPresentation(
  sessionId: string,
  surface: "sidebar" | "widget",
): SurfacePresentation {
  return { sessionId, surface, visibility: "expanded", revision: 0 };
}

export function updatePresentation(
  current: SurfacePresentation,
  change: Partial<Pick<SurfacePresentation, "surface" | "visibility">>,
): SurfacePresentation {
  if (
    (change.surface === undefined || change.surface === current.surface) &&
    (change.visibility === undefined ||
      change.visibility === current.visibility)
  )
    return current;
  return { ...current, ...change, revision: current.revision + 1 };
}

export function dockIntent(x: number, width: number, viewportWidth: number) {
  return viewportWidth - (x + width) <= 24;
}
