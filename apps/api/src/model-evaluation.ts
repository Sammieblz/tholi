import { createHash } from "node:crypto";
import {
  NavigationTransportService,
  type NavigationEvaluationPolicy,
} from "./application/navigation";
import { ModelError } from "./application/model-contracts";
import type { NavigationModel } from "./capabilities";
import { createFakeNavigationModel } from "./adapters/fake-navigation-model";
import { createVertexNavigationModel } from "./adapters/vertex-navigation-model";
import { createGoogleModelAccessToken } from "./adapters/google-model-auth";
import { createIdentityRuntime } from "./adapters/service-identity";
import { createOperatorEvaluationApi } from "./server";
import { parseServiceConfig, type Environment } from "./config";
import { createObservability } from "./adapters/observability";
import {
  openOperatorEvaluation,
  readOperatorEvaluationAudit,
  type OperatorEvaluationRuntime,
} from "./operator-evaluation";
import { evaluationProvenance } from "./evaluation-provenance";
import { isMainModule, runExecutable, startRuntime } from "./runtime";

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** A temporary operator composition, using the same authenticated routes and model port. */
export function createEvaluationPolicy(
  runtime: OperatorEvaluationRuntime,
): NavigationEvaluationPolicy {
  const { plan } = runtime;
  return {
    metadata: runtime.metadata,
    async prepare(input, scope) {
      if (
        input.profile !== "operator-evaluation" ||
        scope.principal.accountId !== plan.operator.accountId ||
        scope.workspaceId !== plan.operator.workspaceId ||
        scope.principal.clientId !== plan.operator.clientId ||
        scope.principal.clientKind !== "extension"
      )
        throw new ModelError("CONFIGURATION");
      const trial = plan.trials.find(
        (item) => item.id === input.evaluation.trialId,
      );
      const task = trial && plan.cases.find((item) => item.id === trial.caseId);
      if (
        !trial ||
        !task ||
        trial.arm === "local" ||
        input.observation.context.goal !== task.goal ||
        (trial.arm === "structured" && input.observation.images.length !== 0) ||
        (trial.arm === "multimodal" && input.observation.images.length === 0)
      )
        throw new ModelError("CONFIGURATION");
      await scope.revalidate();
      const claim = await runtime.claim(
        input.evaluation,
        hash(input.observation),
      );
      const canary = "EVALUATION_PRIVATE_SENTINEL";
      if (JSON.stringify(input.observation).includes(canary)) {
        const error = new ModelError("INVALID_INPUT");
        await runtime.finish(claim, {
          outcome: "not-sent",
          error,
          knownSentinelLeak: true,
        });
        throw error;
      }
      let generated = false;
      let knownSentinelLeak = false;
      const beforeSend = async (
        signal: AbortSignal,
        phase: "count" | "generate",
        requestSha256: string,
      ) => {
        await runtime.beforeSend(claim, signal, phase, requestSha256);
        await scope.revalidate();
        signal.throwIfAborted();
        if (phase === "generate") generated = true;
      };
      const fake = createFakeNavigationModel();
      const model: NavigationModel =
        plan.provider === "fake"
          ? {
              async infer(request, context) {
                await runtime.beforeSend(claim, context.signal);
                await scope.revalidate();
                await runtime.authorizeGeneration(claim, context.signal);
                await beforeSend(context.signal, "generate", hash(request));
                return fake.infer(request, context);
              },
            }
          : createVertexNavigationModel(
              {
                api: plan.model.api,
                project: plan.model.project,
                location: plan.model.location,
                model: "gemini-3.8-flash",
                retentionProfile: plan.model.retentionProfile,
              },
              {
                accessToken: createGoogleModelAccessToken(plan.model.project),
                beforeSend,
                authorizeGeneration: async (signal) => {
                  await runtime.authorizeGeneration(claim, signal);
                  await scope.revalidate();
                },
              },
            );
      return {
        model: {
          async infer(request, context) {
            const result = await model.infer(request, context);
            if (JSON.stringify(result.proposal).includes(canary)) {
              knownSentinelLeak = true;
              throw new ModelError("INVALID_OUTPUT", {
                outcome: "reported",
                usage: result.usage,
              });
            }
            return result;
          },
        },
        budget: {
          maxInputTokens: plan.budget.maxInputTokens,
          maxOutputTokens: plan.budget.maxOutputTokens,
          ...(trial.arm === "structured" ? { maxImages: 0 } : {}),
        },
        async finish(result) {
          const error =
            result.error instanceof ModelError
              ? result.error
              : result.error
                ? new ModelError("PROVIDER_ERROR", {
                    outcome: generated ? "unknown" : "not-sent",
                  })
                : undefined;
          await runtime.finish(claim, {
            outcome: result.usage
              ? "reported"
              : generated
                ? (error?.outcome ?? "unknown")
                : "not-sent",
            usage: result.usage,
            error,
            knownSentinelLeak,
            proposalKind: result.decision?.decision.kind,
            proposalSha256: result.decision
              ? hash(result.decision.decision)
              : undefined,
          });
          const stopped = runtime.audit().stopped;
          if (!error && stopped)
            throw new ModelError(
              stopped === "invalid-usage"
                ? "INVALID_USAGE"
                : stopped === "budget" || stopped === "over-reservation"
                  ? "BUDGET_EXCEEDED"
                  : "CONFIGURATION",
              { outcome: "unknown", usage: result.usage },
            );
        },
      };
    },
  };
}

export async function startOperatorEvaluation(env: Environment = process.env) {
  const config = parseServiceConfig(env);
  if (
    config.listen.host !== "127.0.0.1" ||
    !config.options.identity ||
    !config.options.database ||
    config.options.transport?.trustedProxies?.length ||
    config.options.support ||
    config.options.origins.some(
      (origin) => new URL(origin).hostname !== "127.0.0.1",
    )
  )
    throw new ModelError("CONFIGURATION");
  const planFile = env.THOLI_EVALUATION_PLAN_FILE;
  const stateDirectory = env.THOLI_EVALUATION_STATE_DIRECTORY;
  if (!planFile || !stateDirectory) throw new ModelError("CONFIGURATION");
  const runtime = await openOperatorEvaluation({
    planFile,
    approvalFile: env.THOLI_EVALUATION_APPROVAL_FILE,
    stateDirectory,
  });
  let identity: Awaited<ReturnType<typeof createIdentityRuntime>> | undefined;
  let observer: ReturnType<typeof createObservability> | undefined;
  try {
    observer = createObservability(config.options.observability);
    const provenance = await evaluationProvenance();
    if (
      provenance.sourceRevision !== runtime.plan.sourceRevision ||
      (runtime.plan.provider === "vertex" && !provenance.clean) ||
      Object.entries(provenance.hashes).some(
        ([key, value]) =>
          runtime.plan.hashes[key as keyof typeof runtime.plan.hashes] !==
          value,
      )
    )
      throw new ModelError("CONFIGURATION");
    identity = await createIdentityRuntime(
      config.options.identity,
      config.options.database,
      undefined,
      observer,
      false,
    );
    const navigation = new NavigationTransportService(
      identity.repositories,
      createFakeNavigationModel(),
      createEvaluationPolicy(runtime),
    );
    const resources = [
      ...identity.resources,
      {
        name: "operator-evaluation",
        ready: () => Date.now() < runtime.metadata.expiresAtMs,
        stop() {},
        close: () => runtime.close(),
      },
    ];
    return await startRuntime(
      () =>
        createOperatorEvaluationApi(
          { ...config.options, navigation: undefined },
          resources,
          {
            identity: identity!.service,
            authorization: identity!.authorization,
            navigation,
            observability: observer,
          },
        ),
      config.listen,
      { exit: (code) => process.exit(code) },
    );
  } catch (error) {
    await Promise.allSettled([
      runtime.close(),
      ...(observer ? [observer.close()] : []),
      ...(identity?.resources.map((resource) => resource.close()) ?? []),
    ]);
    throw error;
  }
}

if (isMainModule(import.meta.url))
  await runExecutable(async () => {
    if (process.argv.length === 4 && process.argv[2] === "--audit") {
      console.log(
        JSON.stringify(await readOperatorEvaluationAudit(process.argv[3])),
      );
    } else {
      if (process.argv.length !== 2) throw new ModelError("CONFIGURATION");
      await startOperatorEvaluation();
      console.log(
        "Tholi operator evaluation is listening on loopback; no model call starts until an admitted request.",
      );
    }
  });
