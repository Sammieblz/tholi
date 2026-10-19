import { readFile, mkdir, stat, realpath } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
const lock = JSON.parse(
  await readFile("config/testing/browser-tools.json", "utf8"),
);
if (process.platform !== "win32")
  throw Error("The current branded-browser tool cache targets Windows.");
const root = resolve("output/browser-tools");
await mkdir(root, { recursive: true });
if ((await realpath(root)) !== root)
  throw Error("Unexpected browser cache path");
const archive = join(root, "brave-" + lock.brave.version + ".zip"),
  directory = join(root, "brave", lock.brave.version);
const hash = async (path) => {
  const h = createHash("sha256");
  for await (const bytes of createReadStream(path)) h.update(bytes);
  return h.digest("hex");
};
if (!(await stat(archive).catch(() => undefined))) {
  const response = await fetch(lock.brave.url);
  if (!response.ok || !response.body)
    throw Error("Official Brave download failed: " + response.status);
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(archive, { flags: "wx" }),
  );
}
if ((await hash(archive)) !== lock.brave.sha256)
  throw Error(
    "Cached Brave download differs from the pinned official checksum",
  );
if (!(await stat(join(directory, "brave.exe")).catch(() => undefined))) {
  const quote = (s) => "'" + s.replaceAll("'", "''") + "'";
  await mkdir(directory, { recursive: true });
  if ((await realpath(directory)) !== directory)
    throw Error("Unexpected portable browser path");
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "$ErrorActionPreference='Stop'\nAdd-Type -AssemblyName System.IO.Compression.FileSystem\n" +
        "$taskArchive=[System.IO.Compression.ZipFile]::OpenRead(" +
        quote(archive) +
        ")\n" +
        "try { foreach($taskEntry in $taskArchive.Entries) { $taskTarget=[System.IO.Path]::GetFullPath([System.IO.Path]::Combine(" +
        quote(directory) +
        ",$taskEntry.FullName)); if(-not $taskTarget.StartsWith(" +
        quote(directory + "\\") +
        ",[System.StringComparison]::OrdinalIgnoreCase)){ throw 'Unsafe archive member' } } } finally { $taskArchive.Dispose() }\n" +
        "Expand-Archive -LiteralPath " +
        quote(archive) +
        " -DestinationPath " +
        quote(directory) +
        " -Force",
    ],
    { stdio: "inherit" },
  );
}
console.log("Verified portable Brave: " + join(directory, "brave.exe"));
