import type { Target } from "../route-schema";
import type { Landmark, LocatedTarget } from "../shared-types";
import { normalize } from "../state-localizer";
export function rankTargets(
  target: Target,
  landmarks: Landmark[],
): LocatedTarget {
  const names = [...target.names, ...target.synonyms].map(normalize);
  const candidates = landmarks
    .map((l) => {
      const exact = names.includes(normalize(l.name));
      const context =
        !target.context ||
        normalize(l.context).includes(normalize(target.context));
      const contradiction = target.disallowedNearbyText.some((t) =>
        normalize(l.name + " " + l.context).includes(normalize(t)),
      );
      const ineligible = !l.visible || !l.enabled || l.role !== target.role;
      const score =
        contradiction || ineligible
          ? 0
          : (exact ? 0.65 : 0) + 0.2 + (context ? 0.15 : 0);
      const reasons = [
        ...(!l.visible ? ["hidden"] : []),
        ...(!l.enabled ? ["disabled"] : []),
        ...(l.role !== target.role ? ["role-mismatch"] : []),
        ...(!exact ? ["name-mismatch"] : []),
        ...(!context ? ["context-mismatch"] : []),
        ...(contradiction ? ["contradiction"] : []),
        ...(score < target.minimumConfidence ? ["below-threshold"] : []),
      ];
      return {
        id: l.id,
        score,
        rejected:
          ineligible || contradiction || score < target.minimumConfidence,
        reasons,
      };
    })
    .sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best || best.rejected || best.score < target.minimumConfidence)
    return {
      confidence: candidates[0]?.score || 0,
      reason: "Target not found with enough confidence.",
      candidates,
    };
  if (candidates[1] && best.score - candidates[1].score < 0.08)
    return {
      confidence: best.score,
      reason: "Multiple controls match. Navigator will not guess.",
      candidates,
    };
  return {
    id: best.id,
    confidence: best.score,
    reason: "Role, accessible name and context verified.",
    candidates,
  };
}
