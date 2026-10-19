import { PageDiscovery } from "../../../packages/page-discovery/index";
import { PageCoach } from "../../../apps/extension/src/content/page-coach";
import { NavigationCore } from "../../../packages/navigation-core/index";
import {
  SemanticIndex,
  MemoryDerivedStore,
} from "../../../packages/nlp/retrieval";
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
  // The fixture build aliases only its WebExtensions import to transport.ts.
  // Real extension projects exercise the privileged transport independently.
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
