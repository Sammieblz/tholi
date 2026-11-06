import { expect, test, vi } from "vitest";
import {
  forgetPrivateSiteKnowledge,
  privateLearningForgetNotice,
} from "../../../packages/navigation-core/private-learning-controls";
import type { NavigationKnowledgeSiteSettings } from "../../../packages/navigation-core/contracts-navigation-knowledge";

const settings = (): NavigationKnowledgeSiteSettings => ({
  origin: "https://example.test",
  revision: "1",
  collect: true,
  use: true,
  updatedAt: null,
});

test("cloud forget pauses both choices first, chains returned revisions and stops after twenty acknowledged batches", async () => {
  let revision = 1;
  const configure = vi.fn(async () => ({
    ...settings(),
    revision: String(++revision),
    collect: false,
    use: false,
  }));
  const forget = vi.fn(
    async (_origin: string, _revision: string, _idempotencyKey: string) => ({
      siteSettings: {
        ...settings(),
        revision: String(++revision),
        collect: false,
        use: false,
      },
      deletedIds: [],
      hasMore: true,
    }),
  );
  const result = await forgetPrivateSiteKnowledge(settings(), {
    configure,
    forget,
    current() {},
  });
  expect(configure).toHaveBeenCalledExactlyOnceWith({
    origin: settings().origin,
    expectedRevision: "1",
    collect: false,
    use: false,
  });
  expect(forget).toHaveBeenCalledTimes(20);
  expect(forget.mock.calls.map((call) => call[1])).toEqual(
    Array.from({ length: 20 }, (_, index) => String(index + 2)),
  );
  expect(new Set(forget.mock.calls.map((call) => call[2])).size).toBe(20);
  expect(result).toMatchObject({
    hasMore: true,
    batches: 20,
    settings: { revision: "22", collect: false, use: false },
  });
  expect(privateLearningForgetNotice(result.hasMore)).toContain(
    "Some website knowledge remains",
  );
});

test("forget completion requires acknowledged paused settings for the same website", async () => {
  const paused = { ...settings(), collect: false, use: false, revision: "2" };
  const forget = vi.fn(async () => ({
    siteSettings: paused,
    deletedIds: [],
    hasMore: false,
  }));
  const result = await forgetPrivateSiteKnowledge(settings(), {
    configure: async () => paused,
    forget,
    current() {},
  });
  expect(forget).toHaveBeenCalledOnce();
  expect(result.hasMore).toBe(false);
  expect(privateLearningForgetNotice(false)).toContain("was deleted");
  for (const changed of [
    { collect: true },
    { use: true },
    { origin: "https://elsewhere.test" },
  ]) {
    forget.mockClear();
    await expect(
      forgetPrivateSiteKnowledge(settings(), {
        configure: async () => ({ ...paused, ...changed }),
        forget,
        current() {},
      }),
    ).rejects.toThrow("pause was not confirmed");
    expect(forget).not.toHaveBeenCalled();
  }
});

test("scope withdrawal and unknown deletion stop further batches without automatic retries", async () => {
  const paused = { ...settings(), collect: false, use: false, revision: "2" };
  let withdrawn = false;
  const forget = vi.fn(async () => {
    withdrawn = true;
    return { siteSettings: paused, deletedIds: [], hasMore: true };
  });
  await expect(
    forgetPrivateSiteKnowledge(settings(), {
      configure: async () => paused,
      forget,
      current() {
        if (withdrawn) throw new Error("Account changed.");
      },
    }),
  ).rejects.toThrow("Account changed");
  expect(forget).toHaveBeenCalledOnce();
  const uncertain = vi.fn(async () => {
    throw new Error("Response unavailable after send.");
  });
  await expect(
    forgetPrivateSiteKnowledge(settings(), {
      configure: async () => paused,
      forget: uncertain,
      current() {},
    }),
  ).rejects.toThrow("Response unavailable");
  expect(uncertain).toHaveBeenCalledOnce();
});
