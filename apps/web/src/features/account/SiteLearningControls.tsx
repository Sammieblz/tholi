import { useEffect, useState } from "react";
import { PrivateLearningPanel } from "../../../../../packages/ui/PrivateLearningPanel";
import {
  navigationKnowledgeOriginSchema,
  type NavigationKnowledgeSiteSettings,
} from "../../../../../packages/navigation-core/contracts-navigation-knowledge";
import {
  forgetPrivateSiteKnowledge,
  privateLearningForgetNotice,
  PRIVATE_LEARNING_UNCONFIRMED,
} from "../../../../../packages/navigation-core/private-learning-controls";
import { serviceCapabilitiesSchema } from "../../../../../packages/navigation-core/contracts-service";
import { useAccount } from "./session";
import { useAccountOperation } from "./useAccountOperation";
import { accountError } from "./account-error";

export function SiteLearningControls(props: {
  origin: string;
  onForgot?: () => void;
}) {
  const account = useAccount();
  const identity = [
    account.session?.account.id,
    account.session?.account.workspaceId,
    account.session?.session.id,
    props.origin,
  ].join("/");
  return <ScopedSiteLearningControls key={identity} {...props} />;
}

function ScopedSiteLearningControls({
  origin,
  onForgot,
}: {
  origin: string;
  onForgot?: () => void;
}) {
  const account = useAccount();
  const operation = useAccountOperation(account);
  const [settings, setSettings] = useState<NavigationKnowledgeSiteSettings>();
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setSettings(undefined);
    setError("");
    setNotice("");
    void (async () => {
      navigationKnowledgeOriginSchema.parse(origin);
      const capabilities = await account.request(
        "/api/v1/capabilities",
        serviceCapabilitiesSchema,
        "GET",
        undefined,
        controller.signal,
      );
      controller.signal.throwIfAborted();
      if (!capabilities.capabilities.includes("saved-data-schema-2"))
        throw new Error("Private website learning is unavailable.");
      account.setSavedDataView(2);
      const result = await account.savedData.siteSettings(origin);
      controller.signal.throwIfAborted();
      if (result.origin !== origin)
        throw new Error("The website settings changed.");
      setSettings(result);
    })()
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setError(
            accountError(
              failure,
              "Private website learning is unavailable. Refresh or contact support.",
            ),
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [
    account.request,
    account.savedData,
    account.setSavedDataView,
    origin,
    refresh,
  ]);
  return (
    <PrivateLearningPanel
      origin={origin}
      settings={settings}
      busy={loading || operation.busy}
      error={error || (!settings && !loading ? operation.error : "")}
      notice={notice}
      onRefresh={() => {
        operation.resetFeedback();
        setRefresh((value) => value + 1);
      }}
      onSave={(choice) => {
        if (!settings) return;
        setError("");
        setNotice("");
        void operation.run(
          async (signal) => {
            try {
              const result = await account.savedData.updateSiteSettings({
                origin,
                expectedRevision: settings.revision,
                ...choice,
              });
              signal.throwIfAborted();
              if (result.origin !== origin)
                throw new Error("The website settings changed.");
              return result;
            } catch (failure) {
              if (!signal.aborted) {
                setSettings(undefined);
                setError(PRIVATE_LEARNING_UNCONFIRMED);
              }
              throw failure;
            }
          },
          (result) => {
            setSettings(result);
            setNotice(
              "Private learning settings saved. Local memory and AI processing choices are unchanged.",
            );
          },
        );
      }}
      onForget={() => {
        if (!settings) return;
        setError("");
        setNotice("");
        void operation.run(
          async (signal) => {
            try {
              return await forgetPrivateSiteKnowledge(settings, {
                configure: (choice) =>
                  account.savedData.updateSiteSettings(choice),
                forget: (site, revision, key) =>
                  account.savedData.forgetSite(site, revision, key),
                current: () => signal.throwIfAborted(),
              });
            } catch (failure) {
              if (!signal.aborted) {
                setSettings(undefined);
                setError(PRIVATE_LEARNING_UNCONFIRMED);
              }
              throw failure;
            }
          },
          (result) => {
            setSettings(result.settings);
            setNotice(privateLearningForgetNotice(result.hasMore));
            onForgot?.();
          },
        );
      }}
    />
  );
}
