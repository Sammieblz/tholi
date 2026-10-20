import { execFileSync } from "node:child_process";
export async function archiveExtension(
  extension,
  archive,
  files,
  { allowEmptyDirectories = false } = {},
) {
  const quote = (s) => "'" + s.replaceAll("'", "''") + "'";
  execFileSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    "$ErrorActionPreference='Stop'\nAdd-Type -AssemblyName System.IO.Compression.FileSystem\n" +
      "[System.IO.Compression.ZipFile]::CreateFromDirectory(" +
      quote(extension) +
      "," +
      quote(archive) +
      ",[System.IO.Compression.CompressionLevel]::Optimal,$false)",
  ]);
  // Website builds can retain an empty downloads directory in fresh checkouts.
  // Keep the stricter extension default; directory entries contain no file data.
  const entries = allowEmptyDirectories
    ? "$taskZip.Entries | Where-Object { $_.Name -ne '' }"
    : "$taskZip.Entries";
  // Read every zipped file back and compare its bytes with the evaluated build.
  const zipped = JSON.parse(
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "$ErrorActionPreference='Stop'\nAdd-Type -AssemblyName System.IO.Compression.FileSystem\n" +
          "$taskZip=[System.IO.Compression.ZipFile]::OpenRead(" +
          quote(archive) +
          ")\n" +
          "try { @(" +
          entries +
          " | ForEach-Object { $taskStream=$_.Open(); try { $taskHash=[System.Security.Cryptography.SHA256]::Create(); [pscustomobject]@{name=$_.FullName;sha256=([BitConverter]::ToString($taskHash.ComputeHash($taskStream))).Replace('-','').ToLowerInvariant()} } finally { $taskStream.Dispose();$taskHash.Dispose() } }) | ConvertTo-Json -Compress } finally {$taskZip.Dispose()}",
      ],
      { encoding: "utf8" },
    ),
  );
  if (
    zipped.length !== Object.keys(files).length ||
    zipped.some((f) => files[f.name.replaceAll("\\", "/")] !== f.sha256)
  )
    throw new Error("Archive verification failed");
}
