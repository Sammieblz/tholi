import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

/** Capacity schedule for real rapid UI cohorts, never a retry after rejection. */
export async function waitForIdentityGatewayCapacity() {
  const proxy = readFileSync(
    new URL("../../infra/local/gateway/proxy.conf", import.meta.url),
    "utf8",
  );
  const api = readFileSync(
    new URL("../../infra/local/gateway/api.conf", import.meta.url),
    "utf8",
  );
  const rate =
    /^limit_req_zone\s+\$binary_remote_addr\s+zone=([a-z_][a-z0-9_]*):\S+\s+rate=([1-9][0-9]*)r\/(m|s);$/m.exec(
      proxy,
    );
  const burst =
    /^limit_req\s+zone=([a-z_][a-z0-9_]*)\s+burst=([1-9][0-9]*)\s+nodelay;$/m.exec(
      api,
    );
  if (!rate || !burst || rate[1] !== burst[1])
    throw new Error("IDENTITY_GATEWAY_CAPACITY_POLICY_INVALID");
  const milliseconds = Math.ceil(
    (Number(burst[2]) * (rate[3] === "m" ? 60000 : 1000)) / Number(rate[2]),
  );
  if (
    !Number.isSafeInteger(milliseconds) ||
    milliseconds < 1 ||
    milliseconds > 30000
  )
    throw new Error("IDENTITY_GATEWAY_CAPACITY_WAIT_EXCEEDS_BUDGET");
  // Each declared phase fits the actual burst budget. Drain between phases
  // and consecutive browsers sharing an IP without changing service limits.
  await delay(milliseconds);
  return milliseconds;
}
