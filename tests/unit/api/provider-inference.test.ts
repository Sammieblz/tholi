import { beforeEach, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { NavigationModel } from "../../../apps/api/src/capabilities";
import type { CustomerNavigationModelDependencies } from "../../../apps/api/src/adapters/customer-navigation-model";
import type { NavigationInferenceOperation } from "../../../apps/api/src/application/navigation";
import type {
  CustomerInferenceContext,
  QuotaRepositories,
} from "../../../apps/api/src/application/quotas";
const boundary = vi.hoisted(() => ({ adapter: vi.fn(), quota: vi.fn() }));
vi.mock("../../../apps/api/src/adapters/customer-navigation-model", () => ({
  createCustomerNavigationModel: boundary.adapter,
}));
vi.mock("../../../apps/api/src/application/quotas", () => ({
  createNavigationQuotaPolicy: boundary.quota,
}));
import { createProviderInferencePolicy } from "../../../apps/api/src/application/provider-inference";
import {
  ProviderConnectionService,
  type ProviderConnectionStore,
} from "../../../apps/api/src/application/provider-connections";
import { createProviderSecretCipher } from "../../../apps/api/src/adapters/provider-secrets";
import {
  SavedDataService,
  type SavedDataRepositories,
} from "../../../apps/api/src/application/saved-data";
import { createFakeNavigationModel } from "../../../apps/api/src/adapters/fake-navigation-model";
import {
  ModelError,
  resolveModelBudget,
} from "../../../apps/api/src/application/model-contracts";
import { navigationTransportInputSchema } from "../../../packages/navigation-core/contracts-navigation";
import { providerConnectionSelection } from "../../../packages/navigation-core/contracts-providers";
import { retrievedNavigationKnowledgeSchema } from "../../../packages/navigation-core/contracts-navigation-knowledge";
import { providerConnectionMetadataFixture } from "../../support/provider-connection-fixture";
import {
  navigationModelObservation,
  navigationModelValidation,
} from "../../support/navigation-model-fixture";

beforeEach(() => vi.resetAllMocks());
async function fixture() {
  const connection = providerConnectionMetadataFixture(),
    selection = providerConnectionSelection(connection);
  const accountId = randomUUID(),
    workspaceId = randomUUID(),
    controller = new AbortController();
  const context = {
    requestId: randomUUID(),
    deadlineAt: Date.now() + 5000,
    signal: controller.signal,
  };
  const observation = navigationModelObservation();
  const knowledge = retrievedNavigationKnowledgeSchema.parse({
    context: { version: 1, facts: [] },
    sources: [],
    siteSettings: { origin: "https://example.test", revision: "1" },
    contextDigest: "a".repeat(64),
    snapshotDigest: "b".repeat(64),
    diagnostics: { candidates: 0, selected: 0, omitted: 0, reason: "matched" },
  });
  const input = navigationTransportInputSchema.parse({
    requestId: randomUUID(),
    profile: "customer-funded",
    connection: selection,
    observation,
    validation: navigationModelValidation(observation),
    retrieval: {
      origin: "https://example.test",
      snapshotDigest: knowledge.snapshotDigest,
    },
  });
  const unused = async (): Promise<never> => {
    throw Error("This composition fixture must not reach SQL or a provider.");
  };
  const store: ProviderConnectionStore = {
    list: async () => [],
    read: async () => undefined,
    create: unused,
    replace: unused,
    remove: unused,
    markVerified: async () => false,
  };
  const connections = new ProviderConnectionService(
    store,
    createProviderSecretCipher({
      version: 1,
      activeVersion: "fixture",
      keys: { fixture: Buffer.alloc(32, 81).toString("base64url") },
    }),
  );
  const savedRepositories: SavedDataRepositories = { transaction: unused };
  const savedData = new SavedDataService(savedRepositories);
  const repositories: QuotaRepositories = {
    transaction: unused,
    finishInference: unused,
  };
  let connectionCurrent = true,
    knowledgeCurrent = true,
    afterDecrypt = () => {};
  const events: string[] = [];
  const currentConnection = vi
    .spyOn(connections, "assertCurrent")
    .mockImplementation(async () => {
      events.push("connection");
      if (!connectionCurrent) throw new ModelError("STALE_CONTEXT");
      return connection;
    });
  connections.withCredential = async (
    _principal,
    _selected,
    _context,
    work,
  ) => {
    events.push("credentials");
    afterDecrypt();
    return work("synthetic-composition-key", connection);
  };
  const verified = vi
    .spyOn(connections, "markVerified")
    .mockImplementation(async () => {
      events.push("verified");
      return true;
    });
  const retrieved = vi
    .spyOn(savedData, "retrieveKnowledge")
    .mockImplementation(async () => {
      events.push("retrieve");
      return structuredClone(knowledge);
    });
  const revalidated = vi
    .spyOn(savedData, "revalidateKnowledge")
    .mockImplementation(async () => {
      events.push("knowledge");
      if (!knowledgeCurrent) throw new ModelError("STALE_CONTEXT");
    });
  const scope = {
    principal: { accountId },
    workspaceId,
    context,
    revalidate: vi.fn(async () => {
      events.push("request");
    }),
  };
  const fake = createFakeNavigationModel(),
    dispatch = vi.fn();
  let adapterDependencies: CustomerNavigationModelDependencies | undefined;
  boundary.adapter.mockImplementation(
    (_selection, dependencies: CustomerNavigationModelDependencies) => {
      adapterDependencies = dependencies;
      const model: NavigationModel = {
        async infer(request, ctx) {
          return dependencies.withCredential(ctx.signal, async () => {
            await dependencies.beforeSend(ctx.signal, "generate");
            dispatch();
            return fake.infer(request, ctx);
          });
        },
      };
      return model;
    },
  );
  const admissions: {
    customer: CustomerInferenceContext | undefined;
    model: NavigationModel;
  }[] = [];
  boundary.quota.mockImplementation(
    (
      _repositories,
      model: NavigationModel,
      _policy,
      _environment,
      customer: CustomerInferenceContext | undefined,
    ) => ({
      prepare: vi.fn(async () => {
        events.push("admit");
        admissions.push({ customer, model });
        return {
          model,
          budget: resolveModelBudget(),
          finish: vi.fn(),
        } satisfies NavigationInferenceOperation;
      }),
    }),
  );
  const policy = createProviderInferencePolicy(
    repositories,
    fake,
    connections,
    savedData,
    "development",
  );
  return {
    connection,
    selection,
    scope,
    context,
    controller,
    input,
    knowledge,
    connections,
    savedData,
    policy,
    events,
    dispatch,
    currentConnection,
    retrieved,
    revalidated,
    verified,
    admissions,
    get dependencies() {
      return adapterDependencies!;
    },
    setAfterDecrypt(work: () => void) {
      afterDecrypt = work;
    },
    revokeConnection() {
      connectionCurrent = false;
    },
    revokeKnowledge() {
      knowledgeCurrent = false;
    },
  };
}

test("provider composition freezes the selected metadata and retrieval snapshot in one admission without exposing source references to the model", async () => {
  const f = await fixture(),
    prepared = await f.policy.prepare(f.input, f.scope);
  expect(f.policy.customerFunded).toBe(true);
  expect(f.events.indexOf("retrieve")).toBeLessThan(f.events.indexOf("admit"));
  expect(f.admissions[0].customer?.binding).toEqual({
    ...f.selection,
    retrievalSnapshotDigest: f.knowledge.snapshotDigest,
  });
  expect(prepared.knowledge).toEqual(f.knowledge.context);
  expect(prepared.knowledge).not.toHaveProperty("sources");
  expect(prepared.knowledge).not.toHaveProperty("snapshotDigest");
  await prepared.model.infer(
    {
      observation: f.input.observation,
      budget: resolveModelBudget(),
      knowledge: prepared.knowledge,
    },
    f.context,
  );
  expect(f.events.indexOf("credentials")).toBeGreaterThan(
    f.events.indexOf("admit"),
  );
  expect(f.events.at(-1)).toBe("knowledge");
  expect(f.dispatch).toHaveBeenCalledOnce();
  await prepared.revalidate!();
  expect(f.verified).toHaveBeenCalledOnce();
  expect(f.events.slice(-4)).toEqual([
    "verified",
    "request",
    "connection",
    "knowledge",
  ]);
});

test("a changed retrieval snapshot is rejected before customer admission or credential/model creation", async () => {
  const f = await fixture();
  f.input.retrieval!.snapshotDigest = "c".repeat(64);
  await expect(f.policy.prepare(f.input, f.scope)).rejects.toMatchObject({
    code: "STALE_CONTEXT",
  });
  expect(boundary.adapter).not.toHaveBeenCalled();
  expect(f.admissions).toEqual([]);
  expect(f.dispatch).not.toHaveBeenCalled();
});

test.each(["connection", "knowledge"] as const)(
  "%s revocation during credential resolution is rechecked immediately before dispatch",
  async (boundary) => {
    const f = await fixture(),
      prepared = await f.policy.prepare(f.input, f.scope);
    f.setAfterDecrypt(() =>
      boundary === "connection" ? f.revokeConnection() : f.revokeKnowledge(),
    );
    await expect(
      prepared.model.infer(
        {
          observation: f.input.observation,
          budget: resolveModelBudget(),
          knowledge: prepared.knowledge,
        },
        f.context,
      ),
    ).rejects.toMatchObject({ code: "STALE_CONTEXT" });
    expect(f.dispatch).not.toHaveBeenCalled();
    expect(f.verified).not.toHaveBeenCalled();
  },
);

test.each(["connection", "knowledge"] as const)(
  "%s changes after a response prevent release and verification",
  async (boundary) => {
    const f = await fixture(),
      prepared = await f.policy.prepare(f.input, f.scope);
    await prepared.model.infer(
      {
        observation: f.input.observation,
        budget: resolveModelBudget(),
        knowledge: prepared.knowledge,
      },
      f.context,
    );
    boundary === "connection" ? f.revokeConnection() : f.revokeKnowledge();
    await expect(prepared.revalidate!()).rejects.toMatchObject({
      code: "STALE_CONTEXT",
    });
    expect(f.verified).not.toHaveBeenCalled();
  },
);

test("the final response guard still checks private knowledge after best-effort connection verification", async () => {
  const f = await fixture(),
    prepared = await f.policy.prepare(f.input, f.scope);
  f.verified.mockImplementation(async () => {
    f.revokeKnowledge();
    return false;
  });
  await expect(prepared.revalidate!()).rejects.toMatchObject({
    code: "STALE_CONTEXT",
  });
  expect(f.revalidated).toHaveBeenCalled();
});

test("unavailable credentials do not advertise customer inference and operator experiments stay outside the consumer policy", async () => {
  const f = await fixture();
  vi.spyOn(f.connections, "storageAvailable", "get").mockReturnValue(false);
  const unused = async (): Promise<never> => {
    throw Error("Unexpected SQL.");
  };
  const policy = createProviderInferencePolicy(
    { transaction: unused, finishInference: unused },
    createFakeNavigationModel(),
    f.connections,
    f.savedData,
    "development",
  );
  expect(policy.customerFunded).toBeUndefined();
  const operatorInput = navigationTransportInputSchema.parse({
    requestId: f.input.requestId,
    observation: f.input.observation,
    validation: f.input.validation,
    profile: "operator-evaluation",
    evaluation: {
      planSha256: "a".repeat(64),
      trialId: randomUUID(),
      generation: 0,
    },
  });
  await expect(policy.prepare(operatorInput, f.scope)).rejects.toMatchObject({
    code: "CONFIGURATION",
  });
  expect(f.retrieved).not.toHaveBeenCalled();
  expect(boundary.adapter).not.toHaveBeenCalled();
});
