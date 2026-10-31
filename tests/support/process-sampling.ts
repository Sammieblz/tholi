import { execFileSync } from "node:child_process";

export interface BrowserProcessSnapshot {
  processes: number;
  processIds: number[];
  workingSetBytes: number;
  privateCommittedBytes: number;
  cpuSeconds: number;
  sampledAtMs: number;
}

/** Browser-root descendants only; snapshots do not claim simultaneous peak load. */
export function processSnapshot(processId: number): BrowserProcessSnapshot {
  if (!Number.isSafeInteger(processId) || processId < 1)
    throw Error("Browser process identity is required for device measurements");
  return JSON.parse(
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `$taskRoot=${processId}; $taskProcesses=Get-CimInstance Win32_Process; $taskIds=@($taskRoot); do {$taskChildren=@($taskProcesses | Where-Object {$_.ParentProcessId -in $taskIds -and $_.ProcessId -notin $taskIds}); $taskIds+=@($taskChildren.ProcessId | Where-Object {$_})} while($taskChildren.Count); $taskOwned=@($taskProcesses | Where-Object {$_.ProcessId -in $taskIds}); if(-not ($taskOwned | Where-Object {$_.ProcessId -eq $taskRoot})){throw 'Browser root exited'}; @{processes=$taskOwned.Count;processIds=@($taskOwned.ProcessId|Sort-Object);workingSetBytes=($taskOwned|Measure-Object WorkingSetSize -Sum).Sum;privateCommittedBytes=($taskOwned|Measure-Object PrivatePageCount -Sum).Sum;cpuSeconds=(($taskOwned | ForEach-Object {[double]$_.KernelModeTime+[double]$_.UserModeTime} | Measure-Object -Sum).Sum / 10000000);sampledAtMs=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()}|ConvertTo-Json -Compress`,
      ],
      { encoding: "utf8" },
    ),
  );
}
