import { describe, expect, it } from "vitest";
import {
  classifyTone,
  composite,
  luminance,
  oppositeTheme,
  parseColor,
} from "../packages/ui/page-theme";

describe("contrasting page appearance", () => {
  it("composites transparent surfaces before measuring luminance", () => {
    expect(parseColor("rgba(0, 0, 0, 0.5)")).toEqual([0, 0, 0, 0.5]);
    expect(parseColor("rgb(255 255 255 / 0.8)")).toEqual([255, 255, 255, 0.8]);
    expect(parseColor("color(srgb 0.1 0.2 0.3 / 0.5)")).toEqual([
      25.5, 51, 76.5, 0.5,
    ]);
    expect(composite([0, 0, 0, 0.5], [255, 255, 255, 1])).toEqual([
      127.5, 127.5, 127.5, 1,
    ]);
    expect(composite([0, 0, 0, 0], [0, 0, 0, 0])).toEqual([0, 0, 0, 0]);
    expect(luminance([255, 255, 255, 1])).toBeCloseTo(1);
    expect(luminance([0, 0, 0, 1])).toBe(0);
  });
  it("uses the predominant visible surface rather than a small dark header", () => {
    expect(
      classifyTone([0.01, 0.01, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95]),
    ).toBe("light");
    expect(
      oppositeTheme(
        classifyTone([0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.95, 0.95, 0.95]),
      ),
    ).toBe("light");
  });
  it("keeps gray transitions stable, but follows an actual theme change", () => {
    expect(classifyTone([0.18], "dark")).toBe("dark");
    expect(classifyTone([0.18], "light")).toBe("light");
    expect(classifyTone([0.8], "dark")).toBe("light");
    expect(classifyTone([0.03], "light")).toBe("dark");
  });
});
