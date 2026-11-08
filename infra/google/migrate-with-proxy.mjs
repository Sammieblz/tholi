import { spawn } from "node:child_process";
const child = spawn(
  process.execPath,
  ["apps/api/dist/database-cli.js", "migrate"],
  { stdio: "inherit" },
);
const code = await new Promise((resolve) => {
  child.once("error", () => resolve(1));
  child.once("exit", (code) => resolve(code ?? 1));
});
try {
  const r = await fetch("http://127.0.0.1:9091/quitquitquit", {
    method: "POST",
    signal: AbortSignal.timeout(2000),
  });
  if (!r.ok) throw Error();
} catch {
  process.exitCode = 1;
}
process.exitCode = process.exitCode || code;
