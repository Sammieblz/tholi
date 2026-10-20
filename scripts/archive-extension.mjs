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
    `$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskRoot=[System.IO.Path]::GetFullPath(${quote(extension)})
$taskPrefix=$taskRoot
if (-not $taskPrefix.EndsWith([System.IO.Path]::DirectorySeparatorChar.ToString())) {
  $taskPrefix += [System.IO.Path]::DirectorySeparatorChar
}
$taskZip=[System.IO.Compression.ZipFile]::Open(${quote(archive)},[System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($taskFile in [System.IO.Directory]::EnumerateFiles($taskRoot,'*',[System.IO.SearchOption]::AllDirectories)) {
    $taskName=$taskFile.Substring($taskPrefix.Length).Replace('\\','/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($taskZip,$taskFile,$taskName,[System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
  foreach ($taskDirectory in [System.IO.Directory]::EnumerateDirectories($taskRoot,'*',[System.IO.SearchOption]::AllDirectories)) {
    if ([System.IO.Directory]::GetFileSystemEntries($taskDirectory).Length -eq 0) {
      $taskName=$taskDirectory.Substring($taskPrefix.Length).Replace('\\','/') + '/'
      $taskZip.CreateEntry($taskName) | Out-Null
    }
  }
} finally { $taskZip.Dispose() }`,
  ]);
  // Windows PowerShell's .NET Framework helper writes backslashes in ZIP names.
  // Write portable names explicitly and verify the stored names without repair.
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
          "try { @($taskZip.Entries | ForEach-Object { $taskStream=$_.Open(); try { $taskHash=[System.Security.Cryptography.SHA256]::Create(); [pscustomobject]@{name=$_.FullName;directory=$_.FullName.EndsWith('/');sha256=([BitConverter]::ToString($taskHash.ComputeHash($taskStream))).Replace('-','').ToLowerInvariant()} } finally { $taskStream.Dispose();$taskHash.Dispose() } }) | ConvertTo-Json -Compress } finally {$taskZip.Dispose()}",
      ],
      { encoding: "utf8" },
    ),
  );
  const names = zipped.map((file) => file.name);
  if (
    new Set(names).size !== names.length ||
    zipped.some(({ name, directory }) => {
      const path = directory ? name.slice(0, -1) : name;
      return (
        path.includes("\\") ||
        path.split("/").some((part) => !part || part === "." || part === "..")
      );
    })
  )
    throw new Error("Archive contains invalid or duplicate entry names");
  // Website builds may retain empty folders; extension packaging stays strict.
  const entries = allowEmptyDirectories
    ? zipped.filter((file) => !file.directory)
    : zipped;
  if (
    entries.length !== Object.keys(files).length ||
    entries.some(
      (file) =>
        !Object.hasOwn(files, file.name) || files[file.name] !== file.sha256,
    )
  )
    throw new Error("Archive verification failed");
}
