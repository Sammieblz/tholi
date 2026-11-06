import { readFile, appendFile } from "node:fs/promises";

const targets = JSON.parse(
  await readFile(
    new URL("../config/testing/native-platforms.json", import.meta.url),
    "utf8",
  ),
);
if (!process.env.GITHUB_OUTPUT)
  throw Error("A workflow output file is required.");
await appendFile(
  process.env.GITHUB_OUTPUT,
  `matrix=${JSON.stringify(targets)}\n`,
);
