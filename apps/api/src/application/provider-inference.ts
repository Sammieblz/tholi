import { createHash } from "node:crypto";
import { navigationKnowledgeQueryFromObservation } from "../../../../packages/navigation-core/navigation-knowledge-projection";
import type { RetrievedNavigationKnowledge } from "../../../../packages/navigation-core/contracts-navigation-knowledge";
import {
  customerDevelopmentChargingPolicy,
  fakeDevelopmentChargingPolicy,
} from "../../../../packages/navigation-core/contracts-credits";
import type { NavigationModel } from "../capabilities";
import { createCustomerNavigationModel } from "../adapters/customer-navigation-model";
import { ModelError } from "./model-contracts";
import type { NavigationInferencePolicy } from "./navigation";
import { ProviderConnectionService } from "./provider-connections";
import { createNavigationQuotaPolicy, type QuotaRepositories } from "./quotas";
import type { SavedDataService } from "./saved-data";

const noKnowledgeDigest = createHash("sha256")
  .update("tholi-private-knowledge-disabled.v1")
  .digest("hex");

/** One admission/ledger owner, with an explicit per-request provider and private snapshot. */
export function createProviderInferencePolicy(
  repositories: QuotaRepositories,
  localFixture: NavigationModel,
  connections: ProviderConnectionService,
  savedData: SavedDataService,
  environment: "development" | "production",
): NavigationInferencePolicy {
  const fixturePolicy = createNavigationQuotaPolicy(
    repositories,
    localFixture,
    fakeDevelopmentChargingPolicy,
    environment,
  );
  return {
    ...(connections.storageAvailable ? { customerFunded: true as const } : {}),
    async prepare(input, scope) {
      if (input.profile === "operator-evaluation")
        throw new ModelError("CONFIGURATION");
      let knowledge: RetrievedNavigationKnowledge | undefined;
      if (input.retrieval) {
        const query = navigationKnowledgeQueryFromObservation(
          input.observation,
          input.retrieval.origin,
        );
        knowledge = await savedData.retrieveKnowledge(
          scope.principal,
          scope.workspaceId,
          query,
          scope.context,
        );
        if (knowledge.snapshotDigest !== input.retrieval.snapshotDigest)
          throw new ModelError("STALE_CONTEXT");
      }
      const selectedContext = async () => {
        if (input.profile === "customer-funded")
          await connections.assertCurrent(
            scope.principal,
            input.connection,
            scope.context,
          );
        if (knowledge)
          await savedData.revalidateKnowledge(
            scope.principal,
            scope.workspaceId,
            knowledge,
            scope.context,
          );
        scope.context.signal.throwIfAborted();
      };
      const guard = async () => {
        await scope.revalidate();
        await selectedContext();
      };
      await guard();
      let operation;
      if (input.profile === "customer-funded") {
        const selection = input.connection;
        const model = createCustomerNavigationModel(selection, {
          withCredential: (signal, work) =>
            connections.withCredential(
              scope.principal,
              selection,
              { ...scope.context, signal },
              (key) => work(key),
            ),
          beforeSend: async (signal) => {
            signal.throwIfAborted();
            await guard();
            signal.throwIfAborted();
          },
        });
        operation = await createNavigationQuotaPolicy(
          repositories,
          model,
          customerDevelopmentChargingPolicy(selection.provider),
          environment,
          {
            binding: {
              ...selection,
              retrievalSnapshotDigest:
                knowledge?.snapshotDigest ?? noKnowledgeDigest,
            },
            revalidateConnection: selectedContext,
          },
        ).prepare(input, scope);
      } else operation = await fixturePolicy.prepare(input, scope);
      return {
        ...operation,
        ...(knowledge?.context ? { knowledge: knowledge.context } : {}),
        async revalidate() {
          await guard();
          if (input.profile === "customer-funded") {
            await connections.markVerified(
              scope.principal,
              input.connection,
              scope.context,
            );
            await guard();
          }
        },
      };
    },
  };
}
