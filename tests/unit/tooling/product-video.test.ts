import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const directory = "apps/public/media/video";
const hash = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");

describe("genuine product recording", () => {
  it("keeps onboarding footage private, bounded and tied to genuine local verification", async () => {
    const directory = "apps/public/media/onboarding";
    const manifest = JSON.parse(
      await readFile(`${directory}/manifest.json`, "utf8"),
    );
    const provenance = JSON.parse(
      await readFile(`${directory}/provenance.json`, "utf8"),
    );
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.extensionVersion).toBe(provenance.extensionVersion);
    expect(provenance.extensionBuildSha256).toBe(
      hash(JSON.stringify(provenance.artifactFiles)),
    );
    expect(Object.keys(provenance.artifactFiles).length).toBeGreaterThan(100);
    expect(provenance.fixtureSha256).toBe(
      hash(await readFile("scripts/fixtures/onboarding.html")),
    );
    expect(provenance.externalRequests).toEqual([]);
    expect(provenance.evidence).toMatchObject({
      planStatus: "completed",
      journeyStatus: "completed",
    });
    expect(provenance.evidence.verifiedSteps).toBeGreaterThan(0);
    expect(manifest.clips.map((clip: { id: string }) => clip.id)).toEqual([
      "destination",
      "guidance",
      "local",
    ]);
    for (const clip of manifest.clips) {
      const source = provenance.clips.find(
        (item: { id: string }) => item.id === clip.id,
      );
      expect(source.frameValidation.sourceViewports).toEqual(["1040x800"]);
      expect(source.frameValidation.uniformGrayFraction).toBeLessThanOrEqual(
        0.15,
      );
      // Static setup holds legitimately produce fewer compositor updates than
      // the moving guidance footage; the encoder still writes 30 fps.
      expect(source.frameValidation.frameCount).toBeGreaterThan(1);
      expect(clip).toMatchObject({ width: 1040, height: 800, fps: 30 });
      expect(clip.durationSeconds).toBeGreaterThan(3);
      expect(clip.durationSeconds).toBeLessThan(30);
      for (const kind of ["src", "poster", "captions", "transcript"]) {
        const asset = source.assets[kind];
        const bytes = await readFile(`${directory}/${asset.file}`);
        if (kind === "src" || kind === "poster")
          expect(clip[kind]).toBe(`/media/onboarding/${asset.file}`);
        else expect(clip[kind]).toBeUndefined();
        expect(bytes.length).toBe(asset.bytes);
        expect(hash(bytes)).toBe(asset.sha256);
        if (kind === "src") {
          expect(bytes.length).toBeLessThanOrEqual(5 * 1024 * 1024);
          expect(bytes.subarray(0, 4).toString("hex")).toBe("1a45dfa3");
          expect(bytes.includes(Buffer.from("V_VP9"))).toBe(true);
        }
        if (kind === "captions") expect(bytes.toString()).toMatch(/^WEBVTT\n/);
      }
    }
  });

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
