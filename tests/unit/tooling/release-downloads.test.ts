import { expect, test } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  access,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const archiveModule = pathToFileURL(
  resolve("scripts/archive-extension.mjs"),
).href;
const createArchive = (
  source: string,
  archive: string,
  files: Record<string, string>,
  allowEmptyDirectories = false,
) =>
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { archiveExtension } from ${JSON.stringify(archiveModule)}; await archiveExtension(process.argv[1], process.argv[2], JSON.parse(process.argv[3]), {allowEmptyDirectories: process.argv[4] === 'true'});`,
      source,
      archive,
      JSON.stringify(files),
      String(allowEmptyDirectories),
    ],
    { stdio: "pipe" },
  );

test("extension ZIP paths use forward slashes for nested assets and scoped dependency licenses", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tholi-archive-'"));
  const source = join(directory, "extension");
  const archive = join(directory, "firefox.zip");
  const contents = {
    "manifest.json": '{"manifest_version":3,"version":"0.11.0"}',
    "licenses/@babel_runtime-LICENSE": "Bundled dependency license",
    "assets/nested/guide's model.txt": "Preserve these exact bytes",
  };
  const files = Object.fromEntries(
    Object.entries(contents).map(([name, value]) => [
      name,
      createHash("sha256").update(value).digest("hex"),
    ]),
  );
  try {
    await mkdir(join(source, "licenses"), { recursive: true });
    await mkdir(join(source, "assets/nested"), { recursive: true });
    for (const [name, value] of Object.entries(contents))
      await writeFile(join(source, name), value);
    createArchive(source, archive, files);
    const names: string[] = JSON.parse(
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          "Add-Type -AssemblyName System.IO.Compression.FileSystem; " +
            "$taskZip=[System.IO.Compression.ZipFile]::OpenRead('" +
            archive.replaceAll("'", "''") +
            "'); try { @($taskZip.Entries | ForEach-Object { $_.FullName }) | ConvertTo-Json -Compress } finally { $taskZip.Dispose() }",
        ],
        { encoding: "utf8" },
      ),
    );
    expect(names.sort()).toEqual(Object.keys(contents).sort());
    expect(names.every((name) => !name.includes("\\"))).toBe(true);
    // The packager must also retain its per-file byte check.
    await writeFile(join(source, "licenses/@babel_runtime-LICENSE"), "changed");
    expect(() =>
      createArchive(source, join(directory, "changed.zip"), files),
    ).toThrow();
    const originalArchive = await readFile(archive);
    expect(() => createArchive(source, archive, files)).toThrow();
    expect(await readFile(archive)).toEqual(originalArchive);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);

test("archive verification permits empty website folders only by opt-in and rejects unexpected files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tholi-web-archive-"));
  const source = join(directory, "web");
  const files = {
    "index.html": createHash("sha256").update("<h1>Tholi</h1>").digest("hex"),
    "website-release.json": createHash("sha256")
      .update('{"version":"0.1.0"}')
      .digest("hex"),
  };
  const run = (name: string, allowEmptyDirectories: boolean) =>
    createArchive(source, join(directory, name), files, allowEmptyDirectories);
  try {
    await mkdir(join(source, "downloads"), { recursive: true });
    await writeFile(join(source, "index.html"), "<h1>Tholi</h1>");
    await writeFile(
      join(source, "website-release.json"),
      '{"version":"0.1.0"}',
    );
    expect(() => run("strict.zip", false)).toThrow();
    expect(() => run("website.zip", true)).not.toThrow();
    await writeFile(join(source, "unexpected.js"), "unexpected file");
    expect(() => run("unexpected.zip", true)).toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);

test("website releases require increasing versions and matching notes without changing the product version", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tholi-web-version-"));
  const script = resolve("scripts/website-version.mjs");
  const run = (version: string, tag = "") =>
    execFileSync(process.execPath, [script, version], {
      cwd: directory,
      stdio: "pipe",
      env: {
        ...process.env,
        GITHUB_REF_TYPE: tag ? "tag" : "",
        GITHUB_REF_NAME: tag,
      },
    });
  try {
    await mkdir(join(directory, "apps/web"), { recursive: true });
    await mkdir(join(directory, "docs/releases/website/v0.1.0"), {
      recursive: true,
    });
    await writeFile(
      join(directory, "apps/web/release.json"),
      JSON.stringify({ version: "0.1.0" }),
    );
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ version: "0.11.0" }),
    );
    await writeFile(
      join(directory, "docs/releases/website/v0.1.0/README.md"),
      "# Tholi website 0.1.0\n",
    );
    expect(() => run("--check", "web-v0.1.0")).not.toThrow();
    expect(() => run("--check", "web-v0.2.0")).toThrow();
    expect(() => run("0.1.0")).toThrow();
    expect(() => run("../0.2.0")).toThrow();
    expect(() => run("0.2.0")).toThrow();
    await mkdir(join(directory, "docs/releases/website/v0.2.0"), {
      recursive: true,
    });
    await writeFile(
      join(directory, "docs/releases/website/v0.2.0/README.md"),
      "# Wrong release\n",
    );
    expect(() => run("0.2.0")).toThrow();
    await writeFile(
      join(directory, "docs/releases/website/v0.2.0/README.md"),
      "# Tholi website 0.2.0\n",
    );
    expect(() => run("0.2.0")).not.toThrow();
    expect(
      JSON.parse(
        await readFile(join(directory, "apps/web/release.json"), "utf8"),
      ).version,
    ).toBe("0.2.0");
    expect(
      JSON.parse(await readFile(join(directory, "package.json"), "utf8"))
        .version,
    ).toBe("0.11.0");
    expect(() => run("0.1.0")).toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("release versioning keeps metadata in sync and rejects drift, missing notes and mismatched tags", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tholi-version-"));
  const script = resolve("scripts/version.mjs");
  const fixture = {
    name: "tholi",
    version: "0.10.1",
    workspaces: ["apps/api", "packages/nlp"],
  };
  const api = {
    name: "@internet-navigator/api",
    version: "0.10.0",
    dependencies: { "@internet-navigator/nlp": "0.10.0", external: "1.2.3" },
  };
  const nlp = { name: "@internet-navigator/nlp", version: "0.10.0" };
  const lock = {
    version: "0.10.1",
    lockfileVersion: 3,
    packages: {
      "": fixture,
      "apps/api": api,
      "packages/nlp": nlp,
      "node_modules/external": { version: "1.2.3", integrity: "unchanged" },
    },
  };
  const write = async (file: string, value: unknown) =>
    writeFile(join(directory, file), JSON.stringify(value));
  const read = async (file: string) =>
    JSON.parse(await readFile(join(directory, file), "utf8"));
  const run = (arg: string, tag = "") =>
    execFileSync(process.execPath, [script, arg], {
      cwd: directory,
      stdio: "pipe",
      env: {
        ...process.env,
        GITHUB_REF_TYPE: tag ? "tag" : "",
        GITHUB_REF_NAME: tag,
      },
    });
  try {
    for (const path of [
      "apps/api",
      "packages/nlp",
      "apps/extension",
      "docs/releases/v0.11.0",
    ])
      await mkdir(join(directory, path), { recursive: true });
    for (const [file, value] of [
      ["package.json", fixture],
      ["apps/api/package.json", api],
      ["packages/nlp/package.json", nlp],
      ["package-lock.json", lock],
      [
        "apps/extension/manifest.json",
        { version: "0.10.1", manifest_version: 3 },
      ],
    ] as const)
      await write(file, value);
    const original = await readFile(join(directory, "package.json"), "utf8");
    expect(() => run("0.11.0")).toThrow();
    expect(await readFile(join(directory, "package.json"), "utf8")).toBe(
      original,
    );
    await writeFile(
      join(directory, "docs/releases/v0.11.0/README.md"),
      "# Tholi 0.11.0\r\n\r\nUnreleased.\r\n",
    );
    run("0.11.0");
    run("--check", "v0.11.0");
    const updated = await read("package-lock.json");
    for (const path of [
      "package.json",
      "apps/api/package.json",
      "packages/nlp/package.json",
      "apps/extension/manifest.json",
    ])
      expect((await read(path)).version).toBe("0.11.0");
    expect(
      updated.packages["apps/api"].dependencies["@internet-navigator/nlp"],
    ).toBe("0.11.0");
    expect(updated.packages["node_modules/external"]).toEqual(
      lock.packages["node_modules/external"],
    );
    expect((await read("apps/api/package.json")).dependencies.external).toBe(
      "1.2.3",
    );
    expect(() => run("--check", "v0.12.0")).toThrow();
    for (const version of [
      "0.10.0",
      "0.11.0",
      "00.12.0",
      "0.12.0-beta.1",
      "0.65536.0",
    ])
      expect(() => run(version)).toThrow();
    await write("apps/extension/manifest.json", { version: "0.10.1" });
    expect(() => run("--check")).toThrow();
    await write("apps/extension/manifest.json", { version: "0.11.0" });
    updated.packages["apps/api"].dependencies["@internet-navigator/nlp"] =
      "0.10.0";
    await write("package-lock.json", updated);
    expect(() => run("--check")).toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("download sync accepts both release names, preserves archives and rejects tampered bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tholi-downloads-"));
  const releases = join(directory, "output/releases");
  const mirror = join(directory, "apps/public/downloads");
  const script = resolve("scripts/sync-downloads.mjs");
  const run = () =>
    execFileSync(process.execPath, [script], { cwd: directory, stdio: "pipe" });
  const manifest = async () =>
    JSON.parse(await readFile(join(mirror, "manifest.json"), "utf8"));
  const archive = async (stem: string, version: string, bytes: Buffer) => {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await writeFile(join(releases, `${stem}.zip`), bytes);
    await writeFile(
      join(releases, `${stem}.json`),
      JSON.stringify({
        extensionVersion: version,
        archiveSha256: sha256,
        metrics: {},
        regressions: {},
        status: "fixture",
        ...(stem.startsWith("tholi-firefox-") ? { target: "firefox" } : {}),
      }),
    );
    return sha256;
  };
  try {
    await mkdir(releases, { recursive: true });
    const legacy = Buffer.from("legacy packaged fixture");
    await archive("internet-navigator-0.10.0", "0.10.0", legacy);
    run();
    expect((await manifest()).url).toBe(
      "/downloads/internet-navigator-0.10.0.zip",
    );

    expect((await manifest()).targets.firefox).toBeNull();
    const firefox = Buffer.from("Firefox temporary fixture");
    await archive("tholi-firefox-0.10.1", "0.10.1", firefox);
    const current = Buffer.from("Tholi packaged fixture");
    const sha256 = await archive("tholi-0.10.1", "0.10.1", current);
    // Backend and unrelated records cannot become extension downloads.
    await writeFile(join(releases, "tholi-api-99.0.0.json"), "{}");
    run();
    expect(await manifest()).toMatchObject({
      version: "0.10.1",
      url: "/downloads/tholi-0.10.1.zip",
      sha256,
      bytes: current.length,
    });
    expect((await manifest()).targets.firefox).toMatchObject({
      target: "firefox",
      installationKind: "temporary",
      minimumBrowserVersion: "153",
    });
    expect(await readFile(join(mirror, "tholi-firefox-0.10.1.zip"))).toEqual(
      firefox,
    );
    expect(await readFile(join(mirror, "tholi-0.10.1.zip"))).toEqual(current);
    await expect(
      access(join(mirror, "internet-navigator-0.10.0.zip")),
    ).rejects.toThrow();
    expect(
      await readFile(join(releases, "internet-navigator-0.10.0.zip")),
    ).toEqual(legacy);

    await writeFile(join(releases, "tholi-0.10.1.zip"), "tampered");
    expect(run).toThrow(/Packaged download checksum mismatch/);
    expect((await manifest()).sha256).toBe(sha256);
    expect((await manifest()).targets.firefox).toMatchObject({
      target: "firefox",
      installationKind: "temporary",
      minimumBrowserVersion: "153",
    });
    expect(await readFile(join(mirror, "tholi-firefox-0.10.1.zip"))).toEqual(
      firefox,
    );
    expect(await readFile(join(mirror, "tholi-0.10.1.zip"))).toEqual(current);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("release evidence rejects PR, partial, skipped, stale and mixed-run certification", async () => {
  const { requireFullEvidence, digest } =
    await import("../../../scripts/evidence.mjs");
  const { completeCases } = await import("../../support/evidence");
  const files = { "worker.js": "verified-bytes" };
  const report = {
    target: "chromium",
    passed: true,
    artifactFiles: files,
    validation: {
      tier: "full",
      selection: "complete",
      runId: "one-run",
      buildDigest: digest(files),
    },
  };
  expect(requireFullEvidence(report, files).runId).toBe("one-run");
  expect(() =>
    requireFullEvidence(report, files, undefined, "firefox"),
  ).toThrow();
  expect(
    requireFullEvidence(
      { ...report, target: "firefox" },
      files,
      undefined,
      "firefox",
    ).runId,
  ).toBe("one-run");
  for (const validation of [
    { ...report.validation, tier: "pr" },
    { ...report.validation, selection: "focused" },
    { ...report.validation, runId: "uncoordinated" },
    { ...report.validation, runId: "" },
    { ...report.validation, buildDigest: "old-bytes" },
  ])
    expect(() =>
      requireFullEvidence({ ...report, validation }, files),
    ).toThrow();
  expect(() =>
    requireFullEvidence({ ...report, passed: false }, files),
  ).toThrow();
  expect(() =>
    requireFullEvidence(report, files, { runId: "another-run" }),
  ).toThrow();
  expect(() =>
    requireFullEvidence(report, { "worker.js": "changed" }),
  ).toThrow();
  for (const cases of [
    [],
    [{ id: "safety", name: "safety", status: "skipped" }],
    [{ id: "safety", name: "safety", status: "failed" }],
    [
      { id: "safety", name: "safety", status: "passed" },
      { id: "safety", name: "safety", status: "passed" },
    ],
  ])
    expect(completeCases(["safety"], cases)).toBe(false);
  expect(
    completeCases(
      ["safety"],
      [{ id: "safety", name: "safety", status: "passed" }],
    ),
  ).toBe(true);
});
