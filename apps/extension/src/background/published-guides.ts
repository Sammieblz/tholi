import { z } from "zod";
import { api, type Tabs } from "../platform/api";
import { serviceAuthorizedRequest } from "../platform/service-auth";
import { hostPermissionPattern } from "../platform/host-permissions";
import { observePinnedPage } from "./frame-coordinator";
import type { PinnedSession } from "../../../../packages/route-registry/session";
import { workspacePageSchema } from "../../../../packages/navigation-core/contracts-authorization";
import {
  publishedGuideListSchema,
  publishedGuideQuerySchema,
  publishedGuideStepSchema,
} from "../../../../packages/navigation-core/contracts-organization";
import { publishedStepControl } from "../../../../packages/navigation-core/workflows";

const commandSchema = z
  .object({
    type: z.literal("TEAM_GUIDE"),
    accountId: z.string().uuid(),
    sessionId: z.string().uuid(),
    documentId: z.string().min(1).max(200),
    workspaceId: z.string().uuid().optional(),
    selection: publishedGuideQuerySchema.shape.selection,
  })
  .strict();

export async function publishedGuideCommand(
  raw: unknown,
  owner: {
    session?: PinnedSession;
    activeTab(): Promise<Tabs.Tab>;
    goalGeneration: number;
  },
) {
  const command = commandSchema.parse(raw);
  const session = owner.session,
    generation = owner.goalGeneration;
  if (!session?.origin || !session.documentId)
    throw Error("No active document.");
  const { origin } = session;
  const current = () =>
    owner.session === session &&
    owner.goalGeneration === generation &&
    session.sessionId === command.sessionId &&
    session.documentId === command.documentId &&
    session.origin === origin &&
    !session.navigationPending &&
    session.view?.status === "running";
  const check = async () => {
    const tab = await owner.activeTab();
    if (
      tab.id !== session.tabId ||
      !tab.url ||
      new URL(tab.url).origin !== origin ||
      !(await api.permissions.contains({
        origins: [hostPermissionPattern(origin)],
      })) ||
      !current()
    )
      throw Error("The active website changed.");
    return tab;
  };
  const options = {
    beforeSend: async (connection: { account: { id: string } }) => {
      if (connection.account.id !== command.accountId)
        throw Error("The account changed.");
      await check();
    },
  };
  const tab = await check();
  if (!command.workspaceId) {
    const page = await serviceAuthorizedRequest(
      "/api/v1/workspaces?limit=100",
      workspacePageSchema,
      "GET",
      undefined,
      options,
    );
    await check();
    return {
      workspaces: page.items
        .filter((w) => w.kind === "organization")
        .map((w) => w.id),
    };
  }
  const path =
    `/api/v1/workspaces/${command.workspaceId}/organization/guide-lookup` as const;
  const bound = { ...options, requireAccountBinding: true };
  if (!command.selection) {
    const result = await serviceAuthorizedRequest(
      path,
      publishedGuideListSchema,
      "POST",
      { origin },
      bound,
    );
    await check();
    return result;
  }
  const observation = await observePinnedPage(session, tab, current);
  const step = await serviceAuthorizedRequest(
    path,
    publishedGuideStepSchema,
    "POST",
    { origin, selection: command.selection },
    bound,
  );
  await check();
  const target = publishedStepControl(observation.page, step.milestone);
  let highlighted = false;
  if (target && !observation.view.journey) {
    const reply = await api.tabs.sendMessage(
      session.tabId,
      {
        type: "GUIDE_CONTROL",
        sessionId: session.sessionId,
        controlId: target.id,
        binding: {
          revision: observation.page.revision,
          signature: target.signature,
        },
      },
      { frameId: 0, documentId: command.documentId },
    );
    highlighted = !!reply?.view && !reply.error;
  }
  await check();
  return {
    instruction: step.milestone.instruction,
    count: step.count,
    highlighted,
  };
}
