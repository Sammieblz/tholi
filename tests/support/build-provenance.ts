import { readFile } from "node:fs/promises";
import { artifactFiles as hashArtifacts } from "../../scripts/artifact-files.mjs";
import { digest, validationIdentity } from "../../scripts/evidence.mjs";
export async function buildProvenance(
  target: "chromium" | "firefox" = "chromium",
) {
  const directory =
    target === "firefox" ? "dist/extension-firefox" : "dist/extension";
  const artifactFiles = await hashArtifacts(directory);
  const other = target === "firefox" ? "chromium" : "firefox";
  const otherFiles = await hashArtifacts(
    other === "firefox" ? "dist/extension-firefox" : "dist/extension",
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  });
  const buildTargets: Partial<Record<"chromium" | "firefox", string>> = {
    [target]: digest(artifactFiles),
    ...(otherFiles ? { [other]: digest(otherFiles) } : {}),
  };
  const manifest = JSON.parse(
    await readFile(directory + "/manifest.json", "utf8"),
  );
  return {
    artifactFiles,
    target,
    buildTargets,
    extensionVersion: manifest.version as string,
    validation: { ...validationIdentity(), buildDigest: digest(artifactFiles) },
  };
}
