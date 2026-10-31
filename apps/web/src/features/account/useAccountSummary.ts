import { useEffect, useState } from "react";
import type { z } from "zod";
import {
  identityProfileSchema,
  type IdentityProfile,
} from "../../../../../packages/navigation-core/contracts-identity";
import {
  workspaceCreditsSchema,
  type WorkspaceCredits,
} from "../../../../../packages/navigation-core/contracts-credits";
import {
  productCatalogSchema,
  productEntitlementsSchema,
  type ProductCatalog,
} from "../../../../../packages/navigation-core/contracts-plans";
import {
  savedDataStorageUsageSchema,
  type SavedDataStorageUsage,
} from "../../../../../packages/navigation-core/contracts-saved-data";
import { useAccount } from "./session";
import { accountError } from "./account-error";

type Resources = {
  profile: IdentityProfile;
  catalog: ProductCatalog;
  entitlements: z.infer<typeof productEntitlementsSchema>;
  credits: WorkspaceCredits;
  storage: SavedDataStorageUsage;
};
export type AccountSummary = Partial<Resources> & {
  loading: boolean;
  errors: Partial<Record<keyof Resources, string>>;
  refresh(): void;
};

/** One private read model; failures never make unrelated account data inaccessible. */
export function useAccountSummary(): AccountSummary {
  const account = useAccount();
  const actor = account.session?.account.id;
  const workspace = account.session?.account.workspaceId;
  const session = account.session?.session.id;
  const scope = actor ? JSON.stringify([actor, workspace, session]) : "";
  const request = account.request;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<
    Omit<AccountSummary, "refresh"> & { scope: string }
  >({ scope, loading: true, errors: {} });
  useEffect(() => {
    const controller = new AbortController();
    setState({ scope, loading: !!actor, errors: {} });
    if (!actor || !workspace) return () => controller.abort();
    const load = async <K extends keyof Resources>(
      key: K,
      path: `/api/v1/${string}`,
      schema: z.ZodType<Resources[K]>,
    ) => {
      try {
        const value = await request(
          path,
          schema,
          "GET",
          undefined,
          controller.signal,
        );
        if (!controller.signal.aborted)
          setState((current) => ({ ...current, [key]: value }));
      } catch (error) {
        if (!controller.signal.aborted)
          setState((current) => ({
            ...current,
            errors: { ...current.errors, [key]: accountError(error) },
          }));
      }
    };
    void Promise.all([
      load(
        "profile",
        "/api/v1/account/profile",
        identityProfileSchema.refine((profile) => profile.accountId === actor),
      ),
      load("catalog", "/api/v1/plans", productCatalogSchema),
      load(
        "entitlements",
        `/api/v1/workspaces/${workspace}/entitlements`,
        productEntitlementsSchema,
      ),
      load(
        "credits",
        `/api/v1/workspaces/${workspace}/credits`,
        workspaceCreditsSchema,
      ),
      load(
        "storage",
        `/api/v1/workspaces/${workspace}/artifacts/usage`,
        savedDataStorageUsageSchema,
      ),
    ]).finally(() => {
      if (!controller.signal.aborted)
        setState((current) => ({ ...current, loading: false }));
    });
    return () => controller.abort();
  }, [actor, workspace, session, scope, request, revision]);
  const visible =
    state.scope === scope ? state : { loading: !!actor, errors: {} };
  return { ...visible, refresh: () => setRevision((current) => current + 1) };
}

export const formatQuantity = (value: string) =>
  new Intl.NumberFormat().format(BigInt(value));
