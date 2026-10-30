import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { assertOwnedSmokeProject } from "./local-stack-policy.mjs";
import { createWebsiteDelivery } from "./website-delivery.mjs";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));

/** Validate the resolved overlay without retaining credentials in its report. */
export function inspectVmGateway(resolved, base) {
  const gateway = resolved.services?.gateway;
  const targets = new Set([
    "/etc/nginx/nginx.conf",
    "/etc/nginx/tholi-proxy.conf",
    "/etc/nginx/tholi-api.conf",
    "/etc/nginx/tholi-upstream.conf",
    "/etc/nginx/tls",
  ]);
  if (
    gateway?.user !== "101:101" ||
    !gateway.read_only ||
    gateway.image !== base.services.gateway.image ||
    !gateway.cap_drop?.includes("ALL") ||
    !gateway.security_opt?.includes("no-new-privileges:true") ||
    resolved.services.api?.image !== base.services.api.image ||
    gateway.ports?.length !== 2 ||
    !gateway.ports.some(
      (port) => Number(port.target) === 8080 && Number(port.published) === 80,
    ) ||
    !gateway.ports.some(
      (port) => Number(port.target) === 8443 && Number(port.published) === 443,
    ) ||
    gateway.volumes?.length !== targets.size ||
    new Set(gateway.volumes.map((volume) => volume.target)).size !==
      targets.size ||
    gateway.volumes.some(
      (volume) =>
        volume.type !== "bind" ||
        !volume.read_only ||
        !targets.has(volume.target),
    ) ||
    Object.entries(resolved.services).some(
      ([name, service]) => name !== "gateway" && service.ports?.length,
    )
  )
    throw new Error(
      "The VM overlay must preserve private services and expose only HTTP/HTTPS ingress.",
    );
  return {
    image: gateway.image,
    apiImage: resolved.services.api.image,
    targets: [8080, 8443],
  };
}

async function syntheticCertificate(directory) {
  // The native MinGW build works under Windows without MSYS process emulation.
  const candidates =
    process.platform === "win32"
      ? ["C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe", "openssl"]
      : ["openssl"];
  let executable;
  for (const candidate of candidates) {
    try {
      await execute(candidate, ["version"], { timeout: 10000 });
      executable = candidate;
      break;
    } catch {}
  }
  if (!executable)
    throw new Error(
      "Gateway checks require local OpenSSL for synthetic QA certificates.",
    );
  await writeFile(
    join(directory, "openssl.cnf"),
    "[req]\ndistinguished_name=dn\n[dn]\n",
    { mode: 0o600 },
  );
  await execute(
    executable,
    [
      "req",
      "-config",
      join(directory, "openssl.cnf"),
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=api.example.test",
      "-addext",
      "subjectAltName=DNS:api.example.test",
      "-keyout",
      join(directory, "privkey.pem"),
      "-out",
      join(directory, "fullchain.pem"),
    ],
    { timeout: 30000 },
  );
  // These are disposable QA certificates under a host-private parent directory.
  // The nonroot container must be able to read the mounted synthetic key.
  await chmod(join(directory, "privkey.pem"), 0o644);
  return readFile(join(directory, "fullchain.pem"), "utf8");
}

async function fixtureServer({ marker }) {
  const { createServer } = await import("node:http");
  const { createHmac } = await import("node:crypto");
  const server = createServer((request, response) => {
    if (
      request.url === "/stop" &&
      request.headers["x-tholi-qa-owner"] === marker
    ) {
      response.end("stopped");
      setTimeout(() => {
        server.closeAllConnections();
        server.close(() => process.exit(0));
      }, 20);
      return;
    }
    if (request.url === "/ready") {
      response.end(JSON.stringify({ marker }));
      return;
    }
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks);
      const signature = createHmac("sha256", marker)
        .update(
          request.method +
            "\n" +
            request.headers.host +
            "\n" +
            request.url +
            "\n",
        )
        .update(body)
        .digest("hex");
      response.setHeader("Content-Type", "application/json");
      response.setHeader("Cache-Control", "public, max-age=3600");
      if (request.url.includes("quota=1")) {
        response.statusCode = 429;
        response.setHeader("Retry-After", "3600");
      }
      response.end(
        JSON.stringify({
          url: request.url,
          headers: request.headers,
          body: body.toString("hex"),
          signatureMatches:
            signature === request.headers["x-tholi-qa-signature"],
        }),
      );
    });
  });
  server.listen(18889, "0.0.0.0");
}

async function gatewayProbe({ proxy, ca, origin, marker }) {
  const assert = (await import("node:assert/strict")).default;
  const http = await import("node:http"),
    https = await import("node:https");
  const { createHmac } = await import("node:crypto");
  const results = [];
  let phase = "TLS startup",
    expectedStatus,
    observedStatus,
    transportError = "none",
    responseStarted = false,
    responseComplete = false;
  const tlsAgent = new https.Agent({ keepAlive: true, maxSockets: 16 });
  const plainAgent = new http.Agent({ keepAlive: true, maxSockets: 16 });
  const check = (name) => results.push({ name, passed: true });
  const request = ({
    direct = false,
    website = false,
    tls = true,
    path = "/health/live",
    method = "GET",
    headers = {},
    body,
    dedicated = false,
    servername = "api.example.test",
    timeoutMs = 10000,
  } = {}) =>
    new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : Buffer.from(body);
      const secure = tls && !direct && !website;
      let timedOut = false,
        settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        transportError = timedOut
          ? "TIMEOUT"
          : [
                "ECONNRESET",
                "ECONNREFUSED",
                "EPIPE",
                "ETIMEDOUT",
                "ERR_TLS_CERT_ALTNAME_INVALID",
                "CERT_HAS_EXPIRED",
              ].includes(error?.code)
            ? error.code
            : "OTHER";
        reject(error);
      };
      const req = (secure ? https : http).request(
        {
          hostname: direct ? "127.0.0.1" : proxy,
          port: direct ? 8788 : website ? 8081 : tls ? 8443 : 8080,
          method,
          path,
          agent: dedicated ? false : secure ? tlsAgent : plainAgent,
          ...(secure ? { ca, servername, rejectUnauthorized: true } : {}),
          headers: {
            Host: "api.example.test",
            ...headers,
            ...(payload ? { "Content-Length": payload.length } : {}),
          },
        },
        (response) => {
          if (settled) {
            response.resume();
            return;
          }
          responseStarted = true;
          observedStatus = response.statusCode;
          const chunks = [],
            protocol = response.socket?.getProtocol?.();
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => {
            if (settled) return;
            settled = true;
            responseComplete = response.complete;
            resolve({
              status: response.statusCode,
              headers: response.headers,
              body: Buffer.concat(chunks).toString("utf8"),
              protocol,
            });
          });
          response.on("error", fail);
        },
      );
      req.setTimeout(timeoutMs, () => {
        timedOut = true;
        req.destroy(new Error("Gateway request deadline."));
      });
      req.on("error", fail);
      req.end(payload);
    });
  // Labels are fixed QA operations. Never attach assertion messages or response
  // headers/bodies, which can contain credentials or provider details.
  const expectResponse = async (label, options, expected) => {
    phase = label;
    expectedStatus = expected;
    observedStatus = undefined;
    transportError = "none";
    responseStarted = false;
    responseComplete = false;
    const response = await request(options);
    observedStatus = response.status;
    assert.equal(observedStatus, expectedStatus);
    return response;
  };
  try {
    const privateResponse = (response) =>
      assert.equal(response.headers["cache-control"], "no-store");
    let live;
    const readyBy = Date.now() + 10000;
    while (Date.now() < readyBy) {
      try {
        live = await request({ timeoutMs: 1000 });
        if (live.status === 200) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(live?.status, 200);
    privateResponse(live);
    assert.ok(["TLSv1.2", "TLSv1.3"].includes(live.protocol));
    assert.match(live.headers["strict-transport-security"], /max-age=31536000/);
    check(
      "VM TLS uses a verified matching synthetic certificate and TLS1.2-or-newer",
    );
    const redirect = await request({
      tls: false,
      path: "/api/v1/auth/callback?code=synthetic%2Bcode",
    });
    assert.equal(redirect.status, 308);
    assert.equal(
      redirect.headers.location,
      "https://api.example.test/api/v1/auth/callback?code=synthetic%2Bcode",
    );
    privateResponse(redirect);
    assert.equal(
      (await request({ tls: false, headers: { Host: "other.example.test" } }))
        .status,
      421,
    );
    const wrongHost = await request({
      headers: { Host: "other.example.test" },
    });
    assert.equal(wrongHost.status, 421);
    privateResponse(wrongHost);
    await assert.rejects(() => request({ servername: "other.example.test" }));
    check(
      "VM redirects only its exact canonical hostname and rejects unknown Host/SNI",
    );

    const path =
      "/__tholi_gateway%5Ffixture?name=a%2Fb&name=a+b&empty=&encoded=%252F";
    const body = Buffer.from([0, 1, 2, 255, 128, 13, 10]);
    const signature = createHmac("sha256", marker)
      .update("POST\napi.example.test\n" + path + "\n")
      .update(body)
      .digest("hex");
    const attacker = "203.0.113.19";
    const raw = await request({
      path,
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Tholi-QA-Signature": signature,
        "X-Forwarded-For": attacker,
        "X-Forwarded-Proto": "http",
        "X-Forwarded-Host": "evil.example.test",
        Forwarded: "for=" + attacker,
        "X-Real-IP": attacker,
        "CF-Connecting-IP": attacker,
        "True-Client-IP": attacker,
        "X-Client-IP": attacker,
        "X-Request-Id": "attacker-controlled",
      },
    });
    assert.equal(raw.status, 200);
    privateResponse(raw);
    const captured = JSON.parse(raw.body);
    assert.equal(captured.url, path);
    assert.equal(captured.body, body.toString("hex"));
    assert.equal(captured.signatureMatches, true);
    assert.notEqual(captured.headers["x-forwarded-for"], attacker);
    assert.equal(captured.headers["x-forwarded-proto"], "https");
    assert.equal(captured.headers["x-forwarded-host"], "api.example.test");
    assert.match(captured.headers["x-request-id"], /^[a-f0-9]{32}$/);
    for (const name of [
      "forwarded",
      "x-real-ip",
      "cf-connecting-ip",
      "true-client-ip",
      "x-client-ip",
    ])
      assert.equal(captured.headers[name], undefined);
    check(
      "fixed upstream preserves signature-relevant raw URI/query/Host/body and replaces forged forwarding headers",
    );
    const first = JSON.parse(
      (
        await request({
          path: "/__tholi_gateway_fixture",
          headers: { Authorization: "Bearer synthetic-first" },
        })
      ).body,
    );
    const secondResponse = await request({
      path: "/__tholi_gateway_fixture",
      headers: { Authorization: "Bearer synthetic-second" },
    });
    privateResponse(secondResponse);
    const second = JSON.parse(secondResponse.body);
    assert.equal(first.headers.authorization, "Bearer synthetic-first");
    assert.equal(second.headers.authorization, "Bearer synthetic-second");
    check(
      "proxy does not cache private responses even when the upstream advertises public caching",
    );
    const upstreamQuota = await request({
      path: "/__tholi_gateway_fixture?quota=1",
    });
    assert.equal(upstreamQuota.status, 429);
    assert.equal(upstreamQuota.headers["retry-after"], "3600");
    privateResponse(upstreamQuota);
    check(
      "upstream application Retry-After remains authoritative without duplicate gateway values",
    );

    for (const direct of [false, true]) {
      const boundary = direct ? "direct API" : "TLS proxy";
      const denied = await expectResponse(
        boundary + " authentication",
        {
          direct,
          path: "/api/v1/account",
          headers: { Authorization: "Bearer invalid" },
        },
        401,
      );
      privateResponse(denied);
      assert.notEqual(denied.headers["x-request-id"], "attacker-controlled");
      const preflight = await expectResponse(
        boundary + " allowed CORS preflight",
        {
          direct,
          path: "/api/v1/support/requests",
          method: "OPTIONS",
          headers: {
            Origin: origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
          },
        },
        204,
      );
      assert.equal(preflight.headers["access-control-allow-origin"], origin);
      privateResponse(preflight);
      const forbidden = await expectResponse(
        boundary + " denied CORS preflight",
        {
          direct,
          path: "/api/v1/support/requests",
          method: "OPTIONS",
          headers: {
            Origin: "https://untrusted.example.test",
            "Access-Control-Request-Method": "POST",
          },
        },
        403,
      );
      assert.equal(forbidden.headers["access-control-allow-origin"], undefined);
      privateResponse(forbidden);
      const oversized = await expectResponse(
        boundary + " declared-length body admission",
        {
          direct,
          path: "/api/v1/support/requests",
          method: "POST",
          dedicated: true,
          // Both boundaries reject this declared length before reading a body.
          // Do not race their early close with an unnecessary bulk upload.
          headers: {
            "Content-Type": "application/json",
            "Content-Length": 512 * 1024 + 1,
            Connection: "close",
          },
        },
        413,
      );
      assert.equal(responseComplete, true);
      privateResponse(oversized);
      if (direct) {
        const requestId = oversized.headers["x-request-id"];
        assert.match(
          requestId,
          /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,
        );
        assert.deepEqual(JSON.parse(oversized.body), {
          error: {
            code: "PAYLOAD_TOO_LARGE",
            message: "Request exceeds the size limit.",
            requestId,
            retryable: false,
          },
        });
      }
    }
    check(
      "actual proxy and direct API enforce authentication, CORS, no-store and declared-length admission",
    );
    for (const base of ["account", "welcome"]) {
      for (const alias of [base, base + "/", base + ".html", base + ".html/"]) {
        const response = await request({ website: true, path: "/" + alias });
        assert.equal(response.status, 200);
        assert.match(response.body, /tholi-static-qa-shell/);
        assert.match(response.headers["content-type"], /^text\/html(?:;|$)/);
        assert.equal(response.headers["cache-control"], "private, no-store");
      }
    }
    const asset = await request({
      website: true,
      path: "/assets/qa-12345678.js",
    });
    assert.equal(asset.status, 200);
    assert.match(
      asset.headers["content-type"],
      /^(?:application|text)\/javascript(?:;|$)/,
    );
    assert.equal(asset.body, "/* tholi-static-qa-asset */\n");
    assert.equal(
      asset.headers["cache-control"],
      "public, max-age=31536000, immutable",
    );
    const missingAsset = await request({
      website: true,
      path: "/assets/unapproved-87654321.js",
    });
    assert.equal(missingAsset.status, 404);
    assert.equal(missingAsset.headers["cache-control"], "private, no-store");
    for (const path of ["/", "/sitemap.xml", "/llms.txt"]) {
      const response = await request({ website: true, path });
      assert.equal(response.status, 200);
      assert.equal(response.headers["cache-control"], "private, no-store");
    }
    check(
      "actual Nginx static adapter serves private aliases and metadata without caching and only approved hashed assets as immutable",
    );
    const limited = await Promise.all(
      Array.from({ length: 75 }, () =>
        request({ path: "/__tholi_gateway_fixture" }),
      ),
    );
    assert.ok(limited.some((response) => response.status === 429));
    for (const response of limited.filter(
      (response) => response.status === 429,
    )) {
      privateResponse(response);
      assert.equal(response.headers["retry-after"], "1");
    }
    check(
      "gateway coarse per-peer admission returns uncached429 with Retry-After",
    );
    return { checks: results };
  } catch {
    throw new Error(
      "Gateway validation failed after " +
        (results.at(-1)?.name ?? "TLS startup") +
        "; phase " +
        phase +
        "; observed status " +
        (observedStatus ?? "unavailable") +
        "; expected status " +
        (expectedStatus ?? "unavailable") +
        "; transport " +
        transportError +
        "; response started " +
        responseStarted +
        "; response complete " +
        responseComplete +
        ".",
    );
  } finally {
    tlsAgent.destroy();
    plainAgent.destroy();
  }
}

/** Runs only against the caller's existing disposable stack. No host ports or cloud calls. */
export async function runGatewayChecks({
  docker,
  compose,
  config,
  project,
  directory,
  envFile,
}) {
  assertOwnedSmokeProject(project, project);
  const network = config.networks?.application?.name;
  if (
    config.name !== project ||
    network !== `${project}_application` ||
    !config.networks.application.internal
  )
    throw new Error(
      "Gateway checks require the owned private application network.",
    );
  if (
    !/^nginx\/nginx-unprivileged:[^@]+@sha256:[a-f0-9]{64}$/.test(
      config.services.gateway.image,
    )
  )
    throw new Error(
      "Gateway checks require the existing digest-pinned unprivileged image.",
    );
  const name = `${project}-tls-gateway`;
  const present = (
    await docker([
      "ps",
      "--all",
      "--filter",
      `name=^/${name}$`,
      "--format",
      "{{.Names}}",
    ])
  ).trim();
  if (present)
    throw new Error("The owned gateway check name is already in use.");
  const parent = resolve(directory),
    temporary = resolve(parent, "gateway-tls-qa");
  if (!temporary.startsWith(parent + sep))
    throw new Error("Invalid gateway QA directory.");
  await mkdir(temporary, { mode: 0o700 });
  const marker = randomUUID(),
    files = [
      "nginx.conf",
      "privkey.pem",
      "fullchain.pem",
      "tls.env",
      "openssl.cnf",
      "website.conf",
      "static/index.html",
      "static/account.html",
      "static/welcome.html",
      "static/sitemap.xml",
      "static/llms.txt",
      "static/assets/qa-12345678.js",
    ];
  let attempted = false,
    fixture = false;
  const source = (fn) => `(${fn.toString()})`;
  try {
    const ca = await syntheticCertificate(temporary);
    await mkdir(join(temporary, "static"), { mode: 0o755 });
    await mkdir(join(temporary, "static", "assets"), { mode: 0o755 });
    for (const file of ["index.html", "account.html", "welcome.html"])
      await writeFile(
        join(temporary, "static", file),
        "<!doctype html><title>QA</title><p>tholi-static-qa-shell</p>\n",
        { mode: 0o644 },
      );
    await writeFile(join(temporary, "static", "sitemap.xml"), "<urlset/>\n", {
      mode: 0o644,
    });
    await writeFile(
      join(temporary, "static", "llms.txt"),
      "# Tholi synthetic QA\n",
      { mode: 0o644 },
    );
    await writeFile(
      join(temporary, "static", "assets", "qa-12345678.js"),
      "/* tholi-static-qa-asset */\n",
      { mode: 0o644 },
    );
    await writeFile(
      join(temporary, "website.conf"),
      createWebsiteDelivery(["assets/qa-12345678.js"], ["/", "/account"], {
        "/welcome": "/account",
      }).nginxLocations(),
      { mode: 0o644 },
    );
    if (!envFile || /[\r\n$#"]/.test(temporary))
      throw new Error(
        "Gateway checks require a safe owned TLS directory and local environment.",
      );
    await writeFile(
      join(temporary, "tls.env"),
      `THOLI_TLS_DIRECTORY=${temporary.replaceAll("\\", "/")}\n`,
      { mode: 0o600 },
    );
    const vmResolved = JSON.parse(
      await docker([
        "compose",
        "--env-file",
        resolve(envFile),
        "--env-file",
        join(temporary, "tls.env"),
        "--project-name",
        project,
        "--file",
        resolve(root, "compose.yaml"),
        "--file",
        resolve(root, "infra/vm/compose.gateway.yaml"),
        "config",
        "--format",
        "json",
      ]),
    );
    inspectVmGateway(vmResolved, config);
    const vm = await readFile(resolve(root, "infra/vm/nginx.conf"), "utf8");
    const include = "include /etc/nginx/tholi-api.conf;";
    if (vm.split(include).length !== 2)
      throw new Error("The VM gateway include is ambiguous.");
    const qaApi = vm.replace(
      include,
      "location = /__tholi_gateway_fixture { proxy_pass http://api:18889; }\n        " +
        include,
    );
    const qa = qaApi.replace(
      /\}\s*$/,
      "    server {\n        listen 8081;\n        server_name api.example.test;\n        root /usr/share/tholi-qa;\n        include /etc/nginx/tholi-website.conf;\n    }\n}\n",
    );
    await writeFile(join(temporary, "nginx.conf"), qa, { mode: 0o644 });
    const start = `${source(fixtureServer)}(${JSON.stringify({ marker })}).catch(()=>process.exitCode=1);`;
    fixture = true;
    await compose([
      "exec",
      "-T",
      "-d",
      "api",
      "node",
      "--input-type=module",
      "-e",
      start,
    ]);
    const ready = `for(let i=0;i<50;i++){try{const r=await fetch('http://127.0.0.1:18889/ready');if((await r.json()).marker===${JSON.stringify(marker)})process.exit(0)}catch{}await new Promise(r=>setTimeout(r,100))}process.exit(1)`;
    await compose([
      "exec",
      "-T",
      "api",
      "node",
      "--input-type=module",
      "-e",
      ready,
    ]);
    const mounts = [
      [join(temporary, "nginx.conf"), "/etc/nginx/nginx.conf"],
      [join(temporary, "fullchain.pem"), "/etc/nginx/tls/fullchain.pem"],
      [join(temporary, "privkey.pem"), "/etc/nginx/tls/privkey.pem"],
      [join(temporary, "website.conf"), "/etc/nginx/tholi-website.conf"],
      [join(temporary, "static"), "/usr/share/tholi-qa"],
      ...["proxy", "api", "upstream"].map((part) => [
        resolve(root, `infra/local/gateway/${part}.conf`),
        `/etc/nginx/tholi-${part}.conf`,
      ]),
    ];
    attempted = true;
    await docker([
      "run",
      "--detach",
      "--name",
      name,
      "--label",
      `io.tholi.gateway-check.owner=${project}`,
      "--network",
      network,
      "--user",
      "101:101",
      "--read-only",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,size=16m,mode=1777",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges:true",
      "--pids-limit",
      "32",
      "--memory",
      "64m",
      "--cpus",
      "0.5",
      ...mounts.flatMap(([from, to]) => [
        "--mount",
        `type=bind,source=${from},target=${to},readonly`,
      ]),
      "--entrypoint",
      "nginx",
      config.services.gateway.image,
      "-g",
      "daemon off;",
    ]);
    const probe = `${source(gatewayProbe)}(${JSON.stringify({ proxy: name, ca, origin: config.services.api.environment.THOLI_IDENTITY_WEB_ORIGIN, marker })}).then(result=>process.stdout.write(JSON.stringify(result)),error=>{process.stderr.write((error.message.startsWith('Gateway validation failed after ')?error.message:'Gateway boundary verification failed.')+'\\n');process.exitCode=1;});`;
    const result = JSON.parse(
      await compose(
        ["exec", "-T", "api", "node", "--input-type=module", "-e", probe],
        90000,
      ),
    );
    result.checks.unshift({
      name: "resolved VM overlay exposes only HTTP/HTTPS and reuses the nonroot gateway and API image",
      passed: true,
    });
    const inspected = JSON.parse(await docker(["inspect", name]))[0];
    if (
      inspected.Config.User !== "101:101" ||
      !inspected.HostConfig.ReadonlyRootfs ||
      Object.values(inspected.NetworkSettings.Ports ?? {}).some(
        (bindings) => bindings?.length,
      )
    )
      throw new Error("The TLS QA proxy escaped its runtime boundary.");
    result.configurationHashes = Object.fromEntries(
      await Promise.all(
        [
          "infra/vm/nginx.conf",
          "infra/vm/compose.gateway.yaml",
          "infra/local/gateway/nginx.conf",
          "infra/local/gateway/proxy.conf",
          "infra/local/gateway/api.conf",
          "infra/local/gateway/upstream.conf",
        ].map(async (path) => [
          path,
          createHash("sha256")
            .update(await readFile(resolve(root, path)))
            .digest("hex"),
        ]),
      ),
    );
    return result;
  } finally {
    const failures = [];
    if (attempted) {
      try {
        const exists = (
          await docker([
            "ps",
            "--all",
            "--filter",
            `name=^/${name}$`,
            "--format",
            "{{.Names}}",
          ])
        ).trim();
        if (exists) {
          const inspected = JSON.parse(await docker(["inspect", name]))[0];
          if (
            inspected.Config.Labels?.["io.tholi.gateway-check.owner"] !==
            project
          )
            throw new Error("Refusing to remove an unowned gateway container.");
          await docker(["rm", "--force", name]);
        }
      } catch (error) {
        failures.push(error);
      }
    }
    if (fixture) {
      const stop = `const r=await fetch('http://127.0.0.1:18889/stop',{headers:{'X-Tholi-QA-Owner':${JSON.stringify(marker)}}});if(!r.ok)process.exitCode=1;`;
      try {
        await compose([
          "exec",
          "-T",
          "api",
          "node",
          "--input-type=module",
          "-e",
          stop,
        ]);
      } catch (error) {
        failures.push(error);
      }
    }
    for (const file of files)
      try {
        await rm(join(temporary, file), { force: true });
      } catch (error) {
        failures.push(error);
      }
    for (const subdirectory of ["static/assets", "static"])
      try {
        await rmdir(join(temporary, subdirectory));
      } catch (error) {
        if (error.code !== "ENOENT") failures.push(error);
      }
    try {
      await rmdir(temporary);
    } catch (error) {
      failures.push(error);
    }
    if (failures.length)
      throw new Error("Gateway QA cleanup did not complete.");
  }
}
