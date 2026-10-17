import type { Route } from "../route-schema";
import type { UIState, Localization } from "../shared-types";
import { statePathMatches } from "../safety-policy";
export const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
function hasLandmark(
  ui: UIState,
  p: Route["states"][number]["landmarks"][number],
) {
  return ui.landmarks.some(
    (l) =>
      l.visible &&
      l.role === p.role &&
      (p.anyName || p.names.some((n) => normalize(n) === normalize(l.name))) &&
      (!p.selector || l.selectors?.includes(p.selector)) &&
      (p.inViewport === undefined || l.inViewport === p.inViewport),
  );
}
export function localize(
  route: Route,
  ui: UIState,
  previous?: string,
): Localization {
  const scores = route.states
    .map((state) => {
      const reasons: string[] = [];
      if (state.modal !== undefined && state.modal !== ui.modal)
        reasons.push("modal-mismatch");
      let rejected = reasons.length > 0;
      const matched = state.landmarks.map((p) => hasLandmark(ui, p));
      if (state.landmarks.some((p, i) => p.required && !matched[i])) {
        rejected = true;
        reasons.push("required-landmark-missing");
      }
      if (state.absentLandmarks.some((p) => hasLandmark(ui, p))) {
        rejected = true;
        reasons.push("forbidden-landmark-present");
      }
      const urlMatches = statePathMatches(state, ui.pathname);
      if (!urlMatches) {
        rejected = true;
        reasons.push("path-mismatch");
      }
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
        reasons: [
          ...reasons,
          ...(score < state.minimumConfidence ? ["below-threshold"] : []),
        ],
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
