import { vi } from "vitest";
// Unit owners supply their existing API doubles; integration tests use the real polyfill.
vi.mock("webextension-polyfill", () => ({
  default: new Proxy(
    {},
    {
      get(_target, key) {
        return ((globalThis as any).browser || (globalThis as any).chrome)?.[
          key
        ];
      },
    },
  ),
}));
