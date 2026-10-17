import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const directory = "apps/public/media/video";
const hash = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");

describe("genuine product recording", () => {
  it("keeps both published takes tied to verified outcomes and exact media bytes", async () => {
    const manifest = JSON.parse(
      await readFile(`${directory}/manifest.json`, "utf8"),
    );
    const provenance = JSON.parse(
      await readFile(`${directory}/provenance.json`, "utf8"),
    );
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.workflow).toBe(provenance.workflow);
    expect(manifest.request).toBe(provenance.request);
    expect(manifest.source).toBe(provenance.source);
    expect(manifest.extensionVersion).toBe(provenance.extensionVersion);
    expect(provenance.extensionBuildSha256).toBe(
      hash(JSON.stringify(provenance.artifactFiles)),
    );
    expect(Object.keys(provenance.artifactFiles).length).toBeGreaterThan(100);
    if (manifest.workflow === "wikipedia")
      expect(manifest.title).toMatch(/Wikipedia/);
    for (const theme of ["light", "dark"]) {
      const variant = manifest.variants[theme];
      const recorded = provenance.variants[theme];
      expect(variant).toMatchObject({
        width: 1440,
        height: 960,
        fps: 30,
        theme,
      });
      expect(variant.bytes).toBeGreaterThan(10000);
      expect(variant.bytes).toBeLessThanOrEqual(5 * 1024 * 1024);
      expect(variant.durationSeconds).toBeGreaterThan(5);
      expect(recorded.evidence.workerPlanStatus).toBe("completed");
      expect(recorded.evidence.workerJourneyStatus).toBe("completed");
      expect(recorded.evidence.verifiedSteps).toBeGreaterThan(0);
      expect(recorded.evidence.transitions.length).toBeGreaterThan(0);
      expect(recorded.frameValidation.sourceViewports).toEqual(["1440x960"]);
      expect(recorded.frameValidation.frameCount).toBeGreaterThan(10);
      expect(recorded.frameValidation.arrivalFrame).toMatchObject({
        width: 1440,
        height: 960,
      });
      expect(
        recorded.frameValidation.arrivalFrame.uniformGrayFraction,
      ).toBeLessThanOrEqual(0.15);
      expect(
        recorded.events.map((event: { kind: string }) => event.kind),
      ).toEqual(["destination", "guidance", "interaction", "arrival"]);
      for (const kind of ["src", "poster", "captions"]) {
        expect(variant[kind]).toBe(
          `/media/video/${recorded.assets[kind].file}`,
        );
        const bytes = await readFile(
          `${directory}/${recorded.assets[kind].file}`,
        );
        expect(bytes.length).toBe(recorded.assets[kind].bytes);
        expect(hash(bytes)).toBe(recorded.assets[kind].sha256);
        if (kind === "src") {
          expect(bytes.subarray(0, 4).toString("hex")).toBe("1a45dfa3");
          expect(bytes.includes(Buffer.from("V_VP9"))).toBe(true);
        }
        if (kind === "captions") expect(bytes.toString()).toMatch(/^WEBVTT\n/);
      }
      expect(variant.sha256).toBe(recorded.assets.src.sha256);
    }
    const transcript = await readFile(
      `${directory}/${provenance.transcript.file}`,
    );
    expect(hash(transcript)).toBe(provenance.transcript.sha256);
    expect(manifest.transcript).toBe(
      `/media/video/${provenance.transcript.file}`,
    );
  });
});
