import type { NavigationModel } from "../capabilities";
import { ModelError } from "../application/model-contracts";

/** Reproducible contract development, with no provider call or quality claim. */
export function createFakeNavigationModel(): NavigationModel {
  return {
    async infer({ observation }, context) {
      if (context.signal.aborted) throw new ModelError("CANCELLED");
      if (Date.now() >= context.deadlineAt)
        throw new ModelError("DEADLINE_EXCEEDED");
      const control = observation.controls.find(
        (control) =>
          control.eligible &&
          control.visible &&
          control.enabled &&
          !control.occluded &&
          control.risk === "ordinary",
      );
      return {
        proposal: control
          ? {
              kind: "guide",
              reference: { ...control.reference },
              message: "Follow the highlighted control.",
            }
          : {
              kind: "unsupported",
              reason: "No eligible control is present in this observation.",
            },
        usage: {
          provider: "fake",
          source: "fake",
          model: "tholi-deterministic-v1",
          promptTokens: 0,
          outputTokens: 0,
          thoughtTokens: 0,
          cachedTokens: 0,
          totalTokens: 0,
        },
      };
    },
  };
}
