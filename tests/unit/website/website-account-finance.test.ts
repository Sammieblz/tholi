// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fakeDevelopmentChargingPolicy } from "../../../packages/navigation-core/contracts-credits";
import { productCatalogSchema } from "../../../packages/navigation-core/contracts-plans";
import {
  createProductCatalogFixture,
  createEffectiveProductPlanFixture,
} from "../../support/product-plan-fixture";
import type { AccountSummary } from "../../../apps/web/src/features/account/useAccountSummary";
const state = vi.hoisted(() => ({ account: undefined as unknown }));
vi.mock("../../../apps/web/src/features/account/session", () => ({
  useAccount: () => state.account,
}));
vi.mock("../../../apps/web/src/app/router", () => ({
  SiteLink: ({ to, children }: { to: string; children: React.ReactNode }) =>
    createElement("a", { href: to }, children),
}));
import { AccountCreditsPage } from "../../../apps/web/src/features/account/AccountCreditsPage";
import { AccountPlansPage } from "../../../apps/web/src/features/account/AccountPlansPage";
const request = vi.fn(),
  refresh = vi.fn();
let root: Root, container: HTMLDivElement, summary: AccountSummary;
const session = (id: number) => ({
  account: {
    id: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    workspaceId: `00000000-0000-4000-8000-${String(id + 1).padStart(12, "0")}`,
  },
  session: {
    id: `00000000-0000-4000-8000-${String(id + 2).padStart(12, "0")}`,
  },
});
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  state.account = { session: session(1), request };
  const catalog = createProductCatalogFixture();
  summary = {
    loading: false,
    errors: {},
    refresh,
    catalog,
    entitlements: {
      catalogVersion: catalog.catalogVersion,
      items: [],
      effective: createEffectiveProductPlanFixture(),
    },
    credits: {
      policy: fakeDevelopmentChargingPolicy,
      balance: {
        available: "9007199254740993",
        reserved: "2",
        spent: "3",
        granted: "9007199254740998",
        expired: "4",
        refunded: "1",
      },
    },
    storage: { scope: "account", artifacts: "2", bytes: "1200" },
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const button = (name: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.textContent === name,
  )!;
async function click(name: string) {
  await act(async () => button(name).click());
}
async function credits() {
  await act(async () =>
    root.render(createElement(AccountCreditsPage, { summary })),
  );
}
async function plans() {
  await act(async () =>
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(AccountPlansPage, { summary }),
      ),
    ),
  );
}

it("shows exact authoritative balances and storage without fetching them again, then explicitly pages history and unconfirmed usage", async () => {
  await credits();
  expect(container.textContent).toContain(
    new Intl.NumberFormat().format(9007199254740993n),
  );
  for (const label of [
    "Available",
    "Reserved",
    "Spent",
    "Granted",
    "Expired",
    "Refunded",
  ])
    expect(container.textContent).toContain(label);
  expect(container.textContent).toContain("1,200");
  expect(container.textContent).toContain("Refill eligibility begins");
  expect(request).not.toHaveBeenCalled();
  request.mockResolvedValueOnce({
    items: [
      {
        id: crypto.randomUUID(),
        kind: "settlement",
        amount: "-1",
        createdAt: "2026-10-31T12:00:00Z",
        source: null,
        periodStart: null,
        periodEnd: null,
        expiresAt: null,
        policyVersion: "fake-development-v1",
      },
    ],
    nextCursor: "history-next",
  });
  await click("Load credit history");
  expect(request.mock.calls[0][0]).toContain("/credits/events?limit=20");
  expect(container.querySelector("table")?.textContent).toContain("Settlement");
  request.mockResolvedValueOnce({ items: [], nextCursor: undefined });
  await click("Next credit history");
  expect(request.mock.calls[1][0]).toContain("after=history-next");
  request.mockResolvedValueOnce({
    items: [
      {
        id: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        provider: "fake",
        model: "tholi-deterministic-v1",
        inputUnits: null,
        outputUnits: null,
        providerUsdMicros: null,
        chargedCredits: null,
        policyVersion: "fake-development-v1",
        createdAt: "2026-10-31T12:00:00Z",
      },
    ],
    verification: {
      independentOutcomesAvailable: false,
      costPerVerifiedSuccessUsdMicros: null,
    },
  });
  await click("Load usage activity");
  const cells = [...container.querySelectorAll("table")]
    .at(-1)!
    .querySelectorAll("td");
  expect(
    [...cells].filter((cell) => cell.textContent === "Not confirmed"),
  ).toHaveLength(4);
  expect(container.textContent).not.toContain("$0.000000");
  expect(container.textContent).toContain("not a charge to your account");
  expect(request).toHaveBeenCalledTimes(3);
  summary = {
    ...summary,
    entitlements: undefined,
    errors: { entitlements: "Cloud allowance details are unavailable." },
  };
  await credits();
  expect(container.textContent).toContain(
    "Cloud allowance details are unavailable",
  );
  expect(container.textContent).not.toContain(
    "No product cloud plan is enrolled",
  );
  expect(request).toHaveBeenCalledTimes(3);
});

it("has no paid checkout or inactive action buttons and enables Free only with the catalog's actual development availability", async () => {
  const development = summary.catalog!;
  summary = {
    ...summary,
    catalog: productCatalogSchema.parse({
      ...development,
      environment: "production",
      plans: development.plans.map((plan) =>
        plan.mode === "local"
          ? plan
          : {
              ...plan,
              availability: {
                available: false,
                reason:
                  plan.mode === "paid"
                    ? "billing-not-enabled"
                    : "quality-gate-pending",
              },
              developmentAllowance: null,
            },
      ),
    }),
  };
  await plans();
  expect(button("Enable Free Cloud development")).toBeUndefined();
  expect(container.textContent).toContain(
    "Prices and allowances have not been published",
  );
  expect(container.querySelector('a[href="/download"]')).not.toBeNull();
  expect(request).not.toHaveBeenCalled();
  summary = {
    ...summary,
    catalog: development,
    entitlements: { ...summary.entitlements!, effective: null },
  };
  await plans();
  request.mockResolvedValueOnce({
    effective: createEffectiveProductPlanFixture(),
    grant: {
      id: crypto.randomUUID(),
      amount: "6",
      expiresAt: "2030-01-01T00:00:00Z",
    },
    replayed: false,
  });
  await click("Enable Free Cloud development");
  expect(request).toHaveBeenCalledOnce();
  expect(request.mock.calls[0][0]).toMatch(/\/entitlements\/free$/);
  expect(request.mock.calls[0][2]).toBe("POST");
  expect(request.mock.calls[0][3]).toEqual({});
  expect(request.mock.calls[0][4].aborted).toBe(false);
  expect(refresh).toHaveBeenCalledOnce();
  expect(container.textContent).toContain("processing choice is unchanged");
});

it("an old account's delayed enrollment is aborted and cannot refresh or announce success for the new account", async () => {
  summary = {
    ...summary,
    entitlements: { ...summary.entitlements!, effective: null },
  };
  await plans();
  let complete!: (result: unknown) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  await click("Enable Free Cloud development");
  const signal = request.mock.calls[0][4];
  state.account = { session: session(10), request };
  await plans();
  expect(signal.aborted).toBe(true);
  await act(async () =>
    complete({
      effective: createEffectiveProductPlanFixture(),
      grant: {
        id: crypto.randomUUID(),
        amount: "6",
        expiresAt: "2030-01-01T00:00:00Z",
      },
      replayed: false,
    }),
  );
  expect(refresh).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("allowance was enabled");
  expect(container.textContent).not.toContain("allowance was confirmed");
});
