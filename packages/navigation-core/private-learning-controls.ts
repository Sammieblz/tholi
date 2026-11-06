import {
  navigationKnowledgeForgetSiteResultSchema,
  navigationKnowledgeSiteSettingsSchema,
  type NavigationKnowledgeSiteSettings,
  type NavigationKnowledgeSiteSettingsInput,
} from "./contracts-navigation-knowledge";

export const PRIVATE_LEARNING_UNCONFIRMED =
  "Cloud changes could not be confirmed. Refresh before trying again. Local memory is unchanged.";

/** Shared bounded deletion for the website client and privileged extension RPC. */
export async function forgetPrivateSiteKnowledge(
  previous: NavigationKnowledgeSiteSettings,
  operations: {
    configure(
      choice: Omit<
        NavigationKnowledgeSiteSettingsInput,
        "idempotencyKey" | "approved"
      >,
    ): Promise<unknown>;
    forget(
      origin: string,
      revision: string,
      idempotencyKey: string,
    ): Promise<unknown>;
    current(): void;
  },
) {
  const origin = previous.origin;
  const checked = (raw: unknown) => {
    const settings = navigationKnowledgeSiteSettingsSchema.parse(raw);
    if (settings.origin !== origin || settings.collect || settings.use)
      throw new Error("Private website learning pause was not confirmed.");
    return settings;
  };
  operations.current();
  let settings = checked(
    await operations.configure({
      origin,
      expectedRevision: previous.revision,
      collect: false,
      use: false,
    }),
  );
  operations.current();
  let deleted = 0;
  for (let batches = 1; batches <= 20; batches++) {
    operations.current();
    const result = navigationKnowledgeForgetSiteResultSchema.parse(
      await operations.forget(origin, settings.revision, crypto.randomUUID()),
    );
    operations.current();
    settings = checked(result.siteSettings);
    deleted += result.deletedIds.length;
    if (!result.hasMore || batches === 20)
      return { settings, hasMore: result.hasMore, deleted, batches };
  }
  throw new Error("The private website knowledge batch limit was exceeded.");
}

export function privateLearningForgetNotice(hasMore: boolean) {
  return hasMore
    ? "Cloud learning is paused. Some website knowledge remains. Choose Forget cloud knowledge again to continue. Local memory is unchanged."
    : "Cloud learning is paused and this website's cloud knowledge was deleted. Local memory is unchanged.";
}
