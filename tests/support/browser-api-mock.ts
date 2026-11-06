import { vi } from "vitest";
import { withoutExternalModels } from "./provider-network-guard";
globalThis.fetch = withoutExternalModels(globalThis.fetch);
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
