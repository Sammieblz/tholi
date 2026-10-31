import { openNavigatorExtension } from "./navigator-extension";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createFakeNavigationModel } from "../../apps/api/src/adapters/fake-navigation-model";
import { resolveModelBudget } from "../../apps/api/src/application/model-contracts";
import {
  NAVIGATION_FAKE_CAPABILITY,
  NAVIGATION_TRANSPORT_CAPABILITY,
  navigationTransportInputSchema,
  navigationTransportResponseSchema,
  type NavigationProposal,
  type NavigationTransportInput,
} from "../../packages/navigation-core/contracts-navigation";
import {
  SERVICE_LIMITS,
  serviceErrorEnvelopeSchema,
  type ServiceErrorCode,
} from "../../packages/navigation-core/contracts-service";
import {
  AUTHORIZATION_CONSENT_POLICIES,
  consentUpdateSchema,
  type ConsentUpdate,
} from "../../packages/navigation-core/contracts-authorization";

type FixtureOutcome =
  | { decision: NavigationProposal }
  | { error: ServiceErrorCode; status: 401 | 403 | 409 | 429 | 503 };

export const navigationServicePageHtml =
  '<html lang="en"><head><title>Reading preferences</title></head><body><h1>Reading preferences</h1><label><input id="dark" type="checkbox">Dark</label><input type="password" value="SENTINEL_PRIVATE_FIELD"></body></html>';

/** Shared loopback HTTP fixture; no live provider, account or native prompt proof. */
export async function navigationServiceFixture(
  clientId: "extension-chromium" | "extension-firefox",
) {
  const account = {
    id: randomUUID(),
    workspaceId: randomUUID(),
    revision: "1",
  };
  const tokens = {
    accessToken: "a".repeat(43),
    refreshToken: "r".repeat(43),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    sessionExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
    sessionId: randomUUID(),
    account,
  };
  const session = {
    id: tokens.sessionId,
    clientId,
    clientKind: "extension",
    expiresAt: tokens.sessionExpiresAt,
  };
  const decisions: {
    input: NavigationTransportInput;
    release: (outcome?: FixtureOutcome) => void;
    finished: boolean;
    disconnected: boolean;
    sent: boolean;
  }[] = [];
  const failures: string[] = [];
  const consents = AUTHORIZATION_CONSENT_POLICIES.map((policy) => ({
    ...policy,
    id: randomUUID(),
    granted: policy.purpose === "cloud_inference",
    revision: "1",
  }));
  const consentWrites: ConsentUpdate[] = [];
  const fake = createFakeNavigationModel();
  const server = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization,Content-Type,X-Tholi-Timeout-Ms",
    );
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    const send = (value: unknown) => response.end(JSON.stringify(value));
    const fail = (status: number, code: ServiceErrorCode) => {
      response.statusCode = status;
      send(
        serviceErrorEnvelopeSchema.parse({
          error: {
            code,
            requestId: randomUUID(),
            retryable: false,
            message: "PRIVATE_SERVICE_BODY_SENTINEL",
          },
        }),
      );
    };
    const readBody = async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      return JSON.parse(Buffer.concat(chunks).toString());
    };
    const path = new URL(request.url || "/", "http://localhost").pathname;
    try {
      if (path === "/api/v1/capabilities") {
        send({
          protocol: "tholi-service",
          version: 1,
          implementationVersion: "0.11.0",
          supportedVersions: [1],
          capabilities: [
            NAVIGATION_TRANSPORT_CAPABILITY,
            NAVIGATION_FAKE_CAPABILITY,
          ],
          availability: {
            authentication: true,
            accountData: true,
            decisions: true,
            billing: false,
          },
          limits: SERVICE_LIMITS,
        });
        return;
      }
      if (request.headers.authorization !== `Bearer ${tokens.accessToken}`)
        throw Error("Synthetic fixture authentication was not supplied.");
      if (path === "/api/v1/account") {
        send({ account, session });
        return;
      }
      const workspace = `/api/v1/workspaces/${account.workspaceId}`;
      if (path === `${workspace}/policies`) {
        send({
          workspaceId: account.workspaceId,
          role: "owner",
          allowedActions: [
            "inference.request",
            "consents.read",
            "consents.write",
          ],
          consentPolicies: AUTHORIZATION_CONSENT_POLICIES,
        });
        return;
      }
      if (path === `${workspace}/consents`) {
        if (request.method === "POST") {
          const input = consentUpdateSchema.parse(await readBody());
          const current = consents.find(
            (consent) => consent.purpose === input.purpose,
          );
          if (!current || current.revision !== input.expectedRevision) {
            fail(409, "CONFLICT");
            return;
          }
          consentWrites.push(input);
          Object.assign(current, {
            granted: input.granted,
            policyVersion: input.policyVersion,
            revision: String(BigInt(current.revision) + 1n),
          });
          send(current);
        } else send({ items: consents });
        return;
      }
      if (request.method !== "POST" || path !== `${workspace}/decisions`)
        throw Error("Unexpected synthetic service operation.");
      const input = navigationTransportInputSchema.parse(await readBody());
      let release!: (outcome?: FixtureOutcome) => void;
      const held = new Promise<FixtureOutcome | undefined>((resolve) => {
        release = resolve;
      });
      const pending = {
        input,
        release,
        finished: false,
        disconnected: false,
        sent: false,
      };
      response.once("close", () => {
        pending.disconnected = !response.writableFinished;
      });
      decisions.push(pending);
      const outcome = await held;
      try {
        if (outcome && "error" in outcome) {
          if (!response.destroyed) {
            fail(outcome.status, outcome.error);
            pending.sent = true;
          }
          return;
        }
        const proposal =
          outcome?.decision ??
          (
            await fake.infer(
              { observation: input.observation, budget: resolveModelBudget() },
              {
                requestId: input.requestId,
                deadlineAt: Date.now() + 1000,
                signal: new AbortController().signal,
              },
            )
          ).proposal;
        if (!response.destroyed) {
          send(
            navigationTransportResponseSchema.parse({
              requestId: input.requestId,
              status: "completed",
              replayed: false,
              decision: {
                protocol: input.observation.protocol,
                version: input.observation.version,
                stamp: input.observation.stamp,
                native: input.observation.native,
                decision: proposal,
              },
            }),
          );
          pending.sent = true;
        }
      } finally {
        pending.finished = true;
      }
    } catch (error) {
      failures.push(
        error instanceof Error ? error.message : "Synthetic service failed.",
      );
      if (!response.destroyed) response.writeHead(500).end();
    }
  });
  const close = async () => {
    for (const decision of decisions) decision.release();
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
  };
  try {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw Error("Synthetic service unavailable.");
    const origin = `http://127.0.0.1:${address.port}`;
    const settings = {
      origin,
      tokens,
      inference: {
        profile: "fake" as const,
        enabled: true,
        images: false,
        accountId: account.id,
        workspaceId: account.workspaceId,
      },
    };
    return { origin, settings, decisions, failures, consentWrites, close };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function openNavigationServiceFixture(viewport?: {
  width: number;
  height: number;
}) {
  const service = await navigationServiceFixture("extension-chromium");
  let app: Awaited<ReturnType<typeof openNavigatorExtension>> | undefined;
  const close = async () => {
    try {
      await app?.close();
    } finally {
      await service.close();
    }
  };
  try {
    app = await openNavigatorExtension(viewport);
    // Only the trusted worker receives synthetic fixture credentials. Native
    // permission and real sign-in prompts remain separate evidence.
    await app.worker.evaluate(async (settings) => {
      await chrome.storage.local.setAccessLevel({
        accessLevel: "TRUSTED_CONTEXTS",
      });
      await chrome.storage.local.set({ "service-auth": settings });
    }, service.settings);
    await app.context.route(
      "http://localhost:5173/service-journey/**",
      (route) =>
        route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: navigationServicePageHtml,
        }),
    );
    await app.page.goto("http://localhost:5173/service-journey/start");
    await app.start();
    return { ...service, app, close };
  } catch (error) {
    await close();
    throw error;
  }
}
