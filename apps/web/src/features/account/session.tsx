import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { z } from "zod";
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

type AccountContextValue = {
  configured: boolean;
  loading: boolean;
  error: string;
  session?: IdentityAccountResponse;
  authorizationUrl: (
    action: "signin" | "signup" | "recover" | "verify",
  ) => string | undefined;
  reload: () => Promise<void>;
  renew: () => Promise<void>;
  sessions: () => Promise<z.infer<typeof identitySessionsSchema>>;
  revoke: (id: string) => Promise<void>;
  signOut: (all?: boolean) => Promise<string>;
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
  const clear = useCallback(() => {
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
      method: "GET" | "POST" | "DELETE" = "GET",
      body?: unknown,
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
          signal: pending.current.signal,
          headers: csrfToken ? { "X-Tholi-CSRF": csrfToken } : undefined,
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
  const reload = useCallback(async () => {
    clear();
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
        sessionRef.current = next;
        setSession(next);
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
  }, [clear, request]);
  useEffect(() => {
    void reload();
    return () => {
      generation.current++;
      pending.current.abort();
    };
  }, [reload]);
  const value: AccountContextValue = {
    configured: !!serviceApiOrigin,
    loading,
    error,
    session,
    reload,
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
      const result = await request(
        "/api/v1/auth/logout",
        identityLogoutResponseSchema,
        "POST",
        { all },
      );
      clear();
      return result.providerLogoutUrl;
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
