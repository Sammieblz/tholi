import { describe, expect, it } from "vitest";
import { desktopStore } from "../../../apps/web/src/features/downloads/browsers";

describe("desktop store selection", () => {
  it.each([
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0 Safari/537.36",
      "Chrome",
    ],
    [
      "Mozilla/5.0 (X11; Linux x86_64; rv:153.0) Gecko/20100101 Firefox/153.0",
      "Firefox",
    ],
  ])("recognizes desktop browser %s", (agent, name) => {
    expect(desktopStore(agent)?.name).toBe(name);
  });
  it.each([
    "Mozilla/5.0 (Linux; Android 16) Chrome/140.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Android 16; Mobile; rv:153.0) Firefox/153.0",
    "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X) Version/18.0 Safari/605.1.15",
    "Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
    "unknown",
  ])("keeps browser selection available for %s", (agent) => {
    expect(desktopStore(agent)).toBeUndefined();
  });
});
