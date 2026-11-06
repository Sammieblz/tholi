import { useEffect, useRef, useState } from "react";
import { PrivateLearningPanel } from "../../../../../../packages/ui/PrivateLearningPanel";
import {
  sessionSchema,
  type PinnedSession,
} from "../../../../../../packages/route-registry/session";
import {
  navigationKnowledgeOriginSchema,
  navigationKnowledgeSiteSettingsSchema,
  type NavigationKnowledgeSiteSettings,
} from "../../../../../../packages/navigation-core/contracts-navigation-knowledge";
import {
  forgetPrivateSiteKnowledge,
  privateLearningForgetNotice,
  PRIVATE_LEARNING_UNCONFIRMED,
} from "../../../../../../packages/navigation-core/private-learning-controls";
import { api } from "../../../platform/api";
import { requestBackendAccess } from "../../../platform/site-access";

type Props = {
  account: { id: string; workspaceId: string };
  serviceOrigin: string;
};
type PinnedSite = Pick<PinnedSession, "sessionId" | "tabId" | "documentId"> & {
  origin: string;
};
async function pinnedSite(): Promise<PinnedSite | undefined> {
  const parsed = sessionSchema.safeParse(
    await api.runtime.sendMessage({ type: "GET_SESSION" }),
  );
  if (!parsed.success || parsed.data.navigationPending) return undefined;
  const session = parsed.data;
  const origin = navigationKnowledgeOriginSchema.safeParse(session.origin);
  if (
    !origin.success ||
    (session.view?.page && session.view.page.origin !== origin.data)
  )
    return undefined;
  return {
    sessionId: session.sessionId,
    tabId: session.tabId,
    documentId: session.documentId,
    origin: origin.data,
  };
}

export function PrivateLearningSettings(props: Props) {
  const identity = JSON.stringify([
    props.account.id,
    props.account.workspaceId,
    props.serviceOrigin,
  ]);
  return <AccountPrivateLearningSettings key={identity} {...props} />;
}
function AccountPrivateLearningSettings(props: Props) {
  const [site, setSite] = useState<PinnedSite>();
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let current = true,
      reading = false,
      again = false;
    const read = () => {
      if (reading) {
        again = true;
        return;
      }
      reading = true;
      void pinnedSite()
        .then((value) => {
          if (!current) return;
          setError("");
          setSite((previous) =>
            JSON.stringify(previous) === JSON.stringify(value)
              ? previous
              : value,
          );
        })
        .catch(() => {
          if (current) {
            setSite(undefined);
            setError(
              "The pinned website could not be reviewed. Refresh before changing cloud learning.",
            );
          }
        })
        .finally(() => {
          reading = false;
          if (current && again) {
            again = false;
            read();
          }
        });
    };
    read();
    const port = api.runtime.connect({ name: "tholi-panel" });
    port?.onMessage.addListener(read);
    return () => {
      current = false;
      port?.onMessage.removeListener(read);
      port?.disconnect();
    };
  }, [refresh]);
  if (!site)
    return (
      <section aria-label="Private website learning">
        <p>
          Open a task on a website to review private cloud learning for its
          pinned session. Local memory is unchanged.
        </p>
        {error && <p role="alert">{error}</p>}
        <button type="button" onClick={() => setRefresh((value) => value + 1)}>
          Review pinned website
        </button>
      </section>
    );
  return (
    <PinnedPrivateLearningSettings
      key={JSON.stringify(site)}
      {...props}
      site={site}
    />
  );
}

function PinnedPrivateLearningSettings({
  account,
  serviceOrigin,
  site,
}: Props & { site: PinnedSite }) {
  const [settings, setSettings] = useState<NavigationKnowledgeSiteSettings>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const lifetime = useRef({ current: true, running: false });
  const scope = { accountId: account.id, workspaceId: account.workspaceId };
  const current = () => {
    if (!lifetime.current.current)
      throw new Error("The displayed account or pinned session changed.");
  };
  const rpc = async (message: unknown) => {
    current();
    const value: unknown = await api.runtime.sendMessage(message);
    current();
    if (value && typeof value === "object" && "error" in value)
      throw new Error("Private website learning could not be confirmed.");
    return value;
  };
  const samePinned = async () => {
    const latest = await pinnedSite();
    current();
    if (JSON.stringify(latest) !== JSON.stringify(site))
      throw new Error("The pinned website changed. Refresh before continuing.");
  };
  useEffect(() => {
    const active = lifetime.current;
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    let currentRead = true;
    setBusy(true);
    setSettings(undefined);
    setError("");
    setNotice("");
    void rpc({ type: "SAVED_DATA_SITE_SETTINGS", scope, origin: site.origin })
      .then((value) => {
        const result = navigationKnowledgeSiteSettingsSchema.parse(value);
        if (result.origin !== site.origin)
          throw new Error("The website settings changed.");
        if (currentRead) setSettings(result);
      })
      .catch(() => {
        if (currentRead)
          setError(
            "Private learning settings could not be loaded. Refresh before making changes.",
          );
      })
      .finally(() => {
        if (currentRead) setBusy(false);
      });
    return () => {
      currentRead = false;
    };
  }, [refresh]);
  const act = async <T,>(
    work: () => Promise<T>,
    apply: (result: T) => void,
  ) => {
    if (lifetime.current.running || !lifetime.current.current) return;
    lifetime.current.running = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const value = await work();
      current();
      apply(value);
    } catch {
      if (lifetime.current.current) {
        setSettings(undefined);
        setError(PRIVATE_LEARNING_UNCONFIRMED);
      }
    } finally {
      lifetime.current.running = false;
      if (lifetime.current.current) setBusy(false);
    }
  };
  const configure = (choice: {
    origin: string;
    expectedRevision: string;
    collect: boolean;
    use: boolean;
  }) =>
    rpc({
      type: "SAVED_DATA_SITE_CONFIGURE",
      scope,
      choice: { ...choice, approved: true },
    });
  return (
    <PrivateLearningPanel
      origin={site.origin}
      settings={settings}
      busy={busy}
      error={error}
      notice={notice}
      onRefresh={() => setRefresh((value) => value + 1)}
      onSave={(choice) => {
        if (!settings || busy || lifetime.current.running) return;
        let access: Promise<boolean> | undefined;
        try {
          // Invoke the native grant before any awaited account or session read.
          if (
            (choice.collect && !settings.collect) ||
            (choice.use && !settings.use)
          )
            access = requestBackendAccess(serviceOrigin);
        } catch {
          setError(
            "Data transmission access could not be requested. Settings are unchanged.",
          );
          return;
        }
        void act(
          async () => {
            if (access && !(await access))
              throw new Error("Data transmission access was declined.");
            await samePinned();
            const result = navigationKnowledgeSiteSettingsSchema.parse(
              await configure({
                origin: site.origin,
                expectedRevision: settings.revision,
                ...choice,
              }),
            );
            if (result.origin !== site.origin)
              throw new Error("The website settings changed.");
            return result;
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
        if (!settings || busy) return;
        void act(
          async () => {
            await samePinned();
            return forgetPrivateSiteKnowledge(settings, {
              configure,
              forget: (origin, expectedRevision, idempotencyKey) =>
                rpc({
                  type: "SAVED_DATA_SITE_FORGET",
                  scope,
                  origin,
                  expectedRevision,
                  idempotencyKey,
                  approved: true,
                }),
              current,
            });
          },
          (result) => {
            setSettings(result.settings);
            setNotice(privateLearningForgetNotice(result.hasMore));
          },
        );
      }}
    />
  );
}
