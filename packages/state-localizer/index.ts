import type { Route } from "../route-schema";
import type { UIState, Localization } from "../shared-types";
export const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
export function localize(
  route: Route,
  ui: UIState,
  previous?: string,
): Localization {
  const scores = route.states
    .map((state) => {
      let rejected = state.modal !== undefined && state.modal !== ui.modal;
      const matched = state.landmarks.map((p) =>
        ui.landmarks.some(
          (l) =>
            l.visible &&
            l.role === p.role &&
            p.names.some((n) => normalize(n) === normalize(l.name)),
        ),
      );
      if (state.landmarks.some((p, i) => p.required && !matched[i]))
        rejected = true;
      const urlMatches =
        !state.urlPatterns.length ||
        state.urlPatterns.some((p) => ui.pathname === p);
      if (!urlMatches) rejected = true;
      const evidence = matched.filter(Boolean).length / state.landmarks.length;
      const score = rejected
        ? 0
        : Math.min(
            1,
            evidence * 0.85 +
              (urlMatches ? 0.1 : 0) +
              (state.id === previous ? 0.05 : 0),
          );
      return {
        id: state.id,
        score,
        rejected,
        minimum: state.minimumConfidence,
      };
    })
    .sort((a, b) => b.score - a.score);
  const first = scores[0],
    second = scores[1];
  if (!first || first.rejected || first.score < first.minimum)
    return {
      confidence: first?.score || 0,
      reason: "Unknown screen. No supported state has enough evidence.",
      scores,
    };
  if (second && first.score - second.score < 0.08)
    return {
      confidence: first.score,
      reason: "Ambiguous screen. More than one state matches.",
      scores,
    };
  return {
    stateId: first.id,
    confidence: first.score,
    reason: "Verified semantic landmarks and URL.",
    scores,
  };
}
