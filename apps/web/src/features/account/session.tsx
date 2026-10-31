import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { z } from "zod";
import {
  identityAccountResponseSchema,
  identityLogoutResponseSchema,
  identityRevokedSchema,
  identitySessionsSchema,
  type IdentityAccountResponse,
} from "../../../../../packages/navigation-core/contracts-identity";
import {
  serviceRequest,
  ServiceClientError,
} from "../../../../../packages/navigation-core/service-client";
import { serviceApiOrigin } from "../../config/project";
import { SavedDataClient } from "../../../../../packages/navigation-core/saved-data-client";
import { IndexedDBCloudDataStore } from "../../../../../packages/site-memory/cloud-data";
import {
  savedDataScopeSchema,
  type SavedDataScope,
} from "../../../../../packages/navigation-core/contracts-saved-data";

const accountNoticeSchema = z
  .object({
    type: z.literal("account-change"),
    source: z.string().uuid(),
    scope: savedDataScopeSchema.nullable(),
  })
  .strict();
const accountScope = (
  account: IdentityAccountResponse["account"],
): SavedDataScope => ({
  accountId: account.id,
  workspaceId: account.workspaceId,
});
const sameAccountScope = (
  left: SavedDataScope | null,
  right: SavedDataScope | null,
) =>
  left?.accountId === right?.accountId &&
  left?.workspaceId === right?.workspaceId;
const cloudConnection = (scope: SavedDataScope | null | undefined) =>
  scope && serviceApiOrigin
    ? { ...scope, serviceOrigin: serviceApiOrigin }
    : undefined;

type AccountContextValue = {
  configured: boolean;
  loading: boolean;
  error: string;
  session?: IdentityAccountResponse;
  savedData: SavedDataClient;
  authorizationUrl: (
    action: "signin" | "signup" | "recover" | "verify",
  ) => string | undefined;
  reload: () => Promise<void>;
  renew: () => Promise<void>;
  sessions: () => Promise<z.infer<typeof identitySessionsSchema>>;
  revoke: (id: string) => Promise<void>;
  signOut: (all?: boolean) => Promise<string>;
  request: <T>(
    path: `/api/v1/${string}`,
    schema: z.ZodType<T>,
    method?: "GET" | "POST" | "PATCH" | "DELETE",
    body?: unknown,
    signal?: AbortSignal,
  ) => Promise<T>;
};
const AccountContext = createContext<AccountContextValue | undefined>(
  undefined,
);

/** Cookie credentials remain in the browser. No account information enters public site state. */
export function AccountProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<IdentityAccountResponse>();
  const sessionRef = useRef<IdentityAccountResponse | undefined>(undefined);
  const [loading, setLoading] = useState(!!serviceApiOrigin);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const pending = useRef(new AbortController());
  const savedData = useRef<SavedDataClient | undefined>(undefined);
  const accountChanging = useRef(false);
  const requestRef = useRef<AccountContextValue["request"] | undefined>(
    undefined,
  );
  const channel = useRef<BroadcastChannel | undefined>(undefined);
  const channelSource = useRef<string | undefined>(undefined);
  const lastNotice = useRef<SavedDataScope | null | undefined>(undefined);
  const announce = useCallback((scope: SavedDataScope | null) => {
    if (
      lastNotice.current !== undefined &&
      sameAccountScope(lastNotice.current, scope)
    )
      return;
    lastNotice.current = scope;
    if (channel.current && channelSource.current)
      try {
        channel.current.postMessage({
          type: "account-change",
          source: channelSource.current,
          scope,
        });
      } catch {}
  }, []);
  const clear = useCallback((preserveCloud = false) => {
    const previous = sessionRef.current
      ? accountScope(sessionRef.current.account)
      : lastNotice.current;
    if (preserveCloud) savedData.current?.suspend();
    else
      void savedData.current?.reset(cloudConnection(previous)).catch(() => {});
    generation.current++;
    pending.current.abort();
    pending.current = new AbortController();
    sessionRef.current = undefined;
    setSession(undefined);
    setLoading(false);
  }, []);
  const request = useCallback(
    async <T,>(
      path: `/api/v1/${string}`,
      schema: z.ZodType<T>,
      method: "GET" | "POST" | "PATCH" | "DELETE" = "GET",
      body?: unknown,
      signal?: AbortSignal,
    ): Promise<T> => {
      if (!serviceApiOrigin)
        throw new Error("Accounts are not configured on this website.");
      const revision = generation.current;
      const csrfToken = sessionRef.current?.csrfToken;
      if (method !== "GET" && !csrfToken)
        throw new Error(
          "Open your account again before changing this session.",
        );
      try {
        const result = await serviceRequest(serviceApiOrigin, path, schema, {
          method,
          body,
          credentials: "include",
          expectedAccountId: sessionRef.current?.account.id,
          requireAccountBinding:
            /^\/api\/v1\/workspaces\/[^/]+\/(artifacts(?:\/|\?|$)|sync\/)/.test(
              path,
            ),
          signal: signal
            ? AbortSignal.any([pending.current.signal, signal])
            : pending.current.signal,
          headers:
            method !== "GET" && csrfToken
              ? { "X-Tholi-CSRF": csrfToken }
              : undefined,
        });
        if (revision !== generation.current)
          throw new Error(
            "The account session changed. Open it again to continue.",
          );
        return result;
      } catch (failure) {
        if (
          revision === generation.current &&
          failure instanceof ServiceClientError &&
          failure.status === 401
        )
          clear();
        throw failure;
      }
    },
    [clear],
  );
  requestRef.current = request;
  if (!savedData.current)
    savedData.current = new SavedDataClient({
      store: new IndexedDBCloudDataStore(),
      connection: async () => {
        const current = sessionRef.current;
        return !accountChanging.current && current && serviceApiOrigin
          ? {
              serviceOrigin: serviceApiOrigin,
              accountId: current.account.id,
              workspaceId: current.account.workspaceId,
            }
          : undefined;
      },
      request: (path, schema, method, body, signal) =>
        requestRef.current!(path, schema, method, body, signal),
    });
  const reload = useCallback(
    async (notifyPeers = true) => {
      const previous = sessionRef.current
        ? accountScope(sessionRef.current.account)
        : lastNotice.current;
      clear(true);
      setError("");
      if (!serviceApiOrigin) {
        setLoading(false);
        return;
      }
      setLoading(true);
      const revision = generation.current;
      try {
        const next = await request(
          "/api/v1/account",
          identityAccountResponseSchema,
        );
        if (revision === generation.current) {
          if (
            previous &&
            !sameAccountScope(previous, accountScope(next.account))
          )
            await savedData.current?.reset(cloudConnection(previous));
          if (revision !== generation.current) return;
          sessionRef.current = next;
          setSession(next);
          if (notifyPeers) announce(accountScope(next.account));
          else lastNotice.current = accountScope(next.account);
        }
      } catch (failure) {
        if (
          revision === generation.current &&
          !(failure instanceof ServiceClientError && failure.status === 401)
        )
          setError(
            failure instanceof Error
              ? failure.message
              : "Your account could not be opened.",
          );
      } finally {
        if (revision === generation.current) setLoading(false);
      }
    },
    [clear, request, announce],
  );
  useEffect(() => {
    let peer: BroadcastChannel | undefined;
    if (serviceApiOrigin && typeof BroadcastChannel === "function") {
      channelSource.current ??= crypto.randomUUID();
      try {
        peer = new BroadcastChannel("tholi-account-lifecycle-v1");
      } catch {}
      if (peer) {
        channel.current = peer;
        peer.onmessage = (event) => {
          const notice = accountNoticeSchema.safeParse(event.data);
          if (!notice.success || notice.data.source === channelSource.current)
            return;
          const current = sessionRef.current
            ? accountScope(sessionRef.current.account)
            : null;
          if (sameAccountScope(current, notice.data.scope)) return;
          // Peer messages invalidate only. The account endpoint supplies identity proof.
          void reload(false);
        };
      }
    }
    void reload();
    return () => {
      peer?.close();
      if (channel.current === peer) channel.current = undefined;
      savedData.current?.suspend();
      generation.current++;
      pending.current.abort();
    };
  }, [reload]);
  const value: AccountContextValue = {
    configured: !!serviceApiOrigin,
    loading,
    error,
    session,
    savedData: savedData.current,
    reload,
    request,
    authorizationUrl: (action) => {
      if (!serviceApiOrigin) return;
      const url = new URL("/api/v1/auth/authorize", serviceApiOrigin);
      url.search = new URLSearchParams({
        clientId: "web",
        action,
        destination: "account",
      }).toString();
      return url.href;
    },
    renew: async () => {
      const next = await request(
        "/api/v1/auth/refresh",
        identityAccountResponseSchema,
        "POST",
        { clientId: "web" },
      );
      sessionRef.current = next;
      setSession(next);
    },
    sessions: () => request("/api/v1/account/sessions", identitySessionsSchema),
    revoke: async (id) => {
      await request(
        `/api/v1/account/sessions/${encodeURIComponent(id)}`,
        identityRevokedSchema,
        "DELETE",
      );
      if (sessionRef.current?.session.id === id) clear();
    },
    signOut: async (all = false) => {
      accountChanging.current = true;
      const previous = sessionRef.current
        ? accountScope(sessionRef.current.account)
        : lastNotice.current;
      const cleanup = savedData.current!.reset(cloudConnection(previous));
      try {
        const result = await request(
          "/api/v1/auth/logout",
          identityLogoutResponseSchema,
          "POST",
          { all },
        );
        clear(true);
        await cleanup;
        announce(null);
        return result.providerLogoutUrl;
      } finally {
        accountChanging.current = false;
      }
    },
  };
  return (
    <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
  );
}
export function useAccount() {
  const value = useContext(AccountContext);
  if (!value) throw new Error("Account controls require the account boundary.");
  return value;
}
