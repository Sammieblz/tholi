import { PageDiscovery } from "../../packages/page-discovery";
import { PageCoach } from "../../apps/extension/src/page-coach";
import { NavigationCore } from "../../packages/navigation-core";
import {
  SemanticIndex,
  MemoryDerivedStore,
} from "../../packages/nlp/retrieval";
const core = new NavigationCore(
  new SemanticIndex(
    {
      async embed(texts) {
        return texts.map(() => Array(384).fill(0));
      },
      async dispose() {},
    },
    new MemoryDerivedStore(),
  ),
);
const state: any = { PageDiscovery, core };
(globalThis as any).fixtureEngine = state;
state.start = (origin: string) => {
  // Isolated transport for dynamic DOM fixtures. Production Chrome transport is
  // tested separately; only the logical platform origin is supplied by the fixture.
  (globalThis as any).chrome = { runtime: { sendMessage: async () => ({}) } };
  const coach: PageCoach = new PageCoach(
    (view) => (state.view = structuredClone(view)),
    0,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    async (request, page) =>
      core.plan({
        requestId: request.id,
        request,
        documentId: "fixture",
        revision: page.revision,
        text: request.original,
        observation: { ...page, origin },
        strategy: "fastest",
        protocolVersion: 2,
        contextRevision: coach.view.journey?.workflow?.revision || 0,
        workflow: coach.view.journey?.workflow,
      }),
  );
  state.coach = coach;
  state.view = coach.start();
  state.goal = async (text: string) => {
    const page = coach.view.page!,
      result = await core.plan({
        requestId: crypto.randomUUID(),
        documentId: "fixture",
        revision: page.revision,
        text,
        observation: { ...page, origin },
        strategy: "fastest",
        protocolVersion: 2,
        contextRevision: 0,
      });
    coach.installRequest(result);
  };
};
