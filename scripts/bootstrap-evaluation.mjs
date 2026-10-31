import { build } from "esbuild";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// The temporary CLI stays two levels below the repo, matching tests/support's
// existing relative resource URLs. Existing local-stack modules keep their own URLs.
const directory = resolve("output/qa");
const temporary = resolve(
  directory,
  `evaluation-bootstrap-${randomUUID()}.mjs`,
);
try {
  await mkdir(directory, { recursive: true });
  const result = await build({
    entryPoints: ["tests/support/evaluation-bootstrap.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    write: false,
    logLevel: "silent",
    external: [
      "../../scripts/local-stack.mjs",
      "../../scripts/lib/local-stack-policy.mjs",
    ],
  });
  await writeFile(temporary, result.outputFiles[0].contents, {
    flag: "wx",
    mode: 0o600,
  });
  const { runEvaluationBootstrap } = await import(
    pathToFileURL(temporary).href
  );
  const metadata = await runEvaluationBootstrap();
  process.stdout.write(JSON.stringify(metadata) + "\n");
} catch {
  process.stderr.write(
    "Local evaluation bootstrap refused. Check the owned stack, exact installed callback and explicit private output.\n",
  );
  process.exitCode = 1;
} finally {
  await unlink(temporary).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}
