import { randomUUID } from "node:crypto";
import type { PostgresRepositories } from "../../../apps/api/src/database/repositories";
import type {
  FinishInferenceInput,
  InferenceReservation,
  RepositoryScope,
} from "../../../apps/api/src/database/contracts";
import { NAVIGATION_TRANSPORT_OPERATION } from "../../../packages/navigation-core/contracts-navigation";

/** Shared SQL-only setup for accounting and product-plan integration checks. */
export function inferenceFixture(repositories: PostgresRepositories) {
  return {
    reserveDecision(
      scope: RepositoryScope,
      policyVersion: string,
      journeyId = randomUUID(),
      owner = repositories,
    ) {
      return owner.transaction(scope, async (scoped) => {
        const { request } = await scoped.beginRequest({
          operation: NAVIGATION_TRANSPORT_OPERATION,
          idempotencyKey: randomUUID(),
          payloadHash: "b".repeat(64),
        });
        return scoped.reserveInference({
          requestId: request.id,
          journeyId,
          policyVersion,
          expiresAt: new Date(Date.now() + 20000),
        });
      });
    },
    dispatch(scope: RepositoryScope, held: InferenceReservation) {
      return repositories.transaction(scope, (scoped) =>
        scoped.markInferenceDispatched({
          id: held.id,
          claimToken: held.claimToken,
        }),
      );
    },
    finish(
      held: InferenceReservation,
      input: Omit<FinishInferenceInput, "id" | "claimToken">,
    ) {
      return repositories.finishInference({
        id: held.id,
        claimToken: held.claimToken,
        ...(input.resolution === "not-sent"
          ? {
              inputUnits: 0n,
              outputUnits: 0n,
              providerUsdMicros: 0n,
              chargedCredits: 0n,
            }
          : {}),
        ...input,
      });
    },
  };
}
