# Gateway, CDN and edge delivery

Roadmap [#34](https://github.com/Sammieblz/tholi/issues/34) defines delivery for
the portable service. The API and worker keep the same application image on a
local computer, a VM or a cloud platform. A gateway supplies transport controls;
it does not supply account authority or navigation authority. No cloud resource,
DNS change, production certificate or website deployment is created by this
milestone.

## Owners and trust

The existing Fastify HTTP owner applies service request admission, exact-origin
CORS, bounded bodies, deadlines, safe errors and server-generated request IDs.
Identity, workspace authorization, consent and purpose-specific quotas remain
in their existing application and repository owners. The independent worker
still owns durable mail and private-file effects. There is no alternate edge
implementation of those workflows.

Direct API requests receive the same body, admission, authentication and
authorization checks as proxied requests. Reaching an internal address, passing
a WAF rule, possessing a request ID or sending a trusted-looking header grants
no permissions. In a hosted profile, also restrict origin ingress to the
selected load balancer or gateway with firewall/private-network rules. An
application limit is not a substitute for platform connection and DDoS controls.

Forwarding trust defaults to none. `THOLI_SERVICE_TRUSTED_PROXIES` accepts at
most 32 explicitly selected IP addresses or CIDRs. It rejects aliases,
hop-count trust and catch-all networks. Select the actual proxy peers and
network topology; do not trust every machine able to connect to a shared VM
network. Fastify only derives a forwarded client address through configured
trusted peers. Client-supplied forwarding headers from an untrusted socket
cannot choose another admission bucket. Proxy trust never changes the exact
registered issuer, callback, website origin or session credential policy.

The Nginx adapter overwrites its forwarded host, scheme and client address,
clears alternate client-supplied forwarding headers and supplies its own
correlation ID. Fastify independently replaces incoming `X-Request-Id` with a
UUID in the service response. Neither identifier is an identity credential.
Access logs are disabled in these reference configurations so authorization
codes, private download queries and user-selected paths are not captured.
Observability and its explicit redaction contract belong to
[#35](https://github.com/Sammieblz/tholi/issues/35).

## Limits and CORS

These bounds apply to the service profile, leaving the legacy private API's
contracts unchanged. Invalid transport configuration fails before allocating
SQL, identity or storage adapters.

| Setting                                 | Default | Purpose                                                 |
| --------------------------------------- | ------- | ------------------------------------------------------- |
| `THOLI_SERVICE_RATE_LIMIT_MAX`          | 300     | Requests per client address per window, per API replica |
| `THOLI_SERVICE_RATE_LIMIT_WINDOW_MS`    | 60000   | Admission window                                        |
| `THOLI_SERVICE_RATE_LIMIT_MAX_CLIENTS`  | 4096    | Maximum simultaneous tracked client buckets             |
| `THOLI_SERVICE_MAX_HEADER_BYTES`        | 16384   | Total received header bytes                             |
| `THOLI_SERVICE_HEADERS_TIMEOUT_MS`      | 10000   | Header receipt timeout                                  |
| `THOLI_SERVICE_REQUEST_TIMEOUT_MS`      | 30000   | Complete request receipt timeout                        |
| `THOLI_SERVICE_CONNECTION_TIMEOUT_MS`   | 35000   | Socket inactivity timeout                               |
| `THOLI_SERVICE_KEEP_ALIVE_TIMEOUT_MS`   | 5000    | Idle keep-alive timeout                                 |
| `THOLI_SERVICE_MAX_REQUESTS_PER_SOCKET` | 100     | Maximum requests on a reused connection                 |

Admission returns `429`, `Retry-After` and a safe no-store error before parsing
a body. Tracking is bounded and a full active bucket map fails closed for new
clients. This is a per-replica transport budget, not a global usage quota or
credit ledger. Replicas multiply that budget. Account support quotas and future
inference credits remain authoritative in their shared database owners. Health
polling must fit the transport budget too.

The current service body ceiling is 512 KiB, with tighter route limits such as
the 8 KiB handshake. Nginx enforces the current service ceiling before forwarding
to the API. Later multimodal endpoints must deliberately add their independently
validated image/envelope limits in their owning tickets; a configurable gateway
does not advertise those endpoints today. The application deadline remains
25 seconds. Gateway response timeouts must be at least 35 seconds, so ingress
does not silently shorten that application deadline. There are no automatic
proxy retries of mutations or external effects.

CORS remains in Fastify, with one exact configured website origin for cookies
and only explicitly registered native origins for bearer delivery. Preflight
does not authenticate a client. A denied Origin must not gain access by using
the gateway or a direct address. Cookie mutations still require Origin and CSRF
proof; native bearer sessions retain their separate credential boundary. See
[identity](service-identity.md) and [authorization](service-authorization.md).

## Local and VM profiles

The [local stack](local-stack.md) publishes only loopback gateway ports. Its
fixed upstreams serve the API, local identity provider, captured mail and private
S3-compatible development storage. No caller-selected upstream or open proxy is
supported. The S3 route preserves the original Host, path, query and body for
signature verification; it does not rewrite signed bytes or retry a failed PUT.
Local HTTP and captured SMTP are explicitly development-only.

The VM reference under [`infra/vm/`](../../infra/vm/) replaces the gateway
listener with certificate-mounted TLS and an exact configured API hostname.
It exposes only the API and its health routes, with unknown hosts rejected.
It does not publish the local mail UI, object-storage endpoint, SQL listener or
identity administration UI. Read its setup instructions before using the
Compose override. Production secrets, the public API and website origins, a
production OIDC provider, durable backups and operator-owned certificates must
be configured separately. A development realm is not a production identity
deployment.

Certificate keys are mounted read-only at runtime, never committed or baked
into an image. Rotate them using the operator's secret/certificate workflow.
The reverse proxy runs without root or added Linux capabilities. A VM firewall
should publish only the approved TLS/redirect ports and keep application,
database, storage and provider administration listeners private.

## Public assets and private routes

[`website-delivery.mjs`](../../scripts/lib/website-delivery.mjs) is the single
website cache-policy owner. It generates Cloudflare Pages headers and a portable
Nginx static-host fragment from the actual website asset inventory. The latter
is deployment configuration outside the public website directory, not an
additional website server or required edge function.

`npm run build:web` writes the optional fragment to
`output/deploy/website/nginx-locations.conf`. Include it inside a static website
server whose root is the built `dist/web` directory. It configures MIME types
for browser loading as well as cache policy. The immutable build manifest and
hosted build artifacts include this operator configuration; it stays outside
the public website and existing release archives.

Only build-owned, content-hashed JavaScript, styles and font assets receive
immutable public caching. Unversioned media, icon and download directories
revalidate. Root manifests, release metadata, Markdown and discovery files use
the stronger no-store policy. HTML shells and account, authentication,
callback, credit, saved-data, decision, capture and private-file paths receive
no-store policies. This also protects query-bearing shells reached during an
approved return. The API sends no-store independently, including errors and
private downloads; file links additionally use no-referrer.

Static rendering contains public content only. It must never embed a session,
account profile, CSRF value, authorization code, personal file or credit balance.
The signed-in web app uses the existing account provider after page load.
Cookie/account state is not included in a build or CDN cache key. Deep links and
legacy aliases retain public shells or the existing replacement navigation.
Technical-document redirects retain their separate canonical destinations.

Cloudflare `_headers` rules can overlap and combine values, while redirects run
before header rules. The generated policy avoids a blanket cache rule that
would combine no-store with immutable assets. Private aliases are protected
shells, not an assumption that a static redirect has acquired response headers.
Do not add a Cache Everything rule or an edge worker that overrides these
private boundaries. A future SSR/Pages Function must issue equivalent headers
itself; static `_headers` do not configure function responses.

## Cloud equivalents and explicit edge decisions

| Capability                              | Current owner and decision                                                                       | Hosted equivalent or later milestone                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Public website, assets and deep links   | Use Cloudflare Pages static rendering, redirects and generated cache policy                      | Keep `tholi.io` on its existing approved deployment process                                                                        |
| TLS and API ingress                     | Use portable Nginx locally/on a VM                                                               | Google load balancer/API gateway or another gateway with verified TLS, exact hosts, bounded connections and private origin ingress |
| Coarse abuse and DDoS admission         | Use Nginx plus independent bounded Fastify admission                                             | Gateway/WAF rules, platform DDoS protection and explicit proxy peer configuration; retain application checks                       |
| Identity and account returns            | Use existing OIDC/session application services                                                   | Register exact hosted origins and callback URLs; no second edge auth system                                                        |
| Support mail, expiry and scheduling     | Use the independent durable worker and registered jobs                                           | An optional scheduler may enqueue the same authorized job kind; no duplicate cron business logic                                   |
| Private file transfers                  | Use current authenticated API and private object adapter                                         | Private bucket/IAM and lifecycle backstop; no public CDN or cacheable signed-download redirect                                     |
| Raw signed webhooks                     | Defer a public endpoint until billing #50 implements signature validation and replay handling    | Preserve original bytes through ingress; do not parse/re-serialize in an edge wrapper                                              |
| Model inference and multimodal requests | Defer to #36 and #39/#40                                                                         | Keep provider credentials server-side; extend explicit route limits only with the real validated transport                         |
| Operational telemetry                   | Defer instrumentation to #35                                                                     | Reuse the observability port with bounded, redacted export                                                                         |
| Edge functions                          | Defer execution because current static routing and API/worker owners meet the demonstrated needs | Add only a thin, locally tested transport wrapper when a concrete platform constraint requires it                                  |

Moving to a gateway product does not require a different application service,
worker workflow, database schema or browser navigation engine. Gateway request
validation is defense in depth. It does not replace application validation or
permit a public origin bypass. Desktop clients will use the same versioned
service contracts, with their own explicitly registered native return URLs.
The server never acquires journey or OS-action authority.

## Validation and operator review

Focused HTTP tests cover real direct sockets, request IDs, untrusted forwarding,
explicit trusted peers, CORS/preflight, body/transport bounds and bounded 429
admission. Website tests verify the generated Cloudflare and Nginx policy,
private aliases, immutable asset inventory and credential-free static HTML.
The disposable local-stack runner additionally exercises actual Nginx routing,
synthetic TLS/host rejection, forwarding, no-store failures, body admission and
unchanged raw bytes. Its test-only raw-byte receiver is not a production webhook
route. The runner removes its owned TLS fixture and private key after checking.

Run `npm run test:ci` and `npm run test:local-stack -- --optional` using the
repository's [testing policy](testing/README.md). Record exact source and results
in [the dated evidence](testing/service-delivery-validation.md). These checks do
not establish Cloudflare edge behavior, Google WAF policy, an internet-trusted
certificate, a deployed origin firewall or a production load budget. Those
require separate authorized deployment and post-deployment verification.

Primary behavior references: [Fastify proxy trust](https://fastify.dev/docs/latest/Reference/Server/#trustproxy),
[Nginx request admission](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html),
[Cloudflare Pages headers](https://developers.cloudflare.com/pages/configuration/headers/)
and [Cloudflare redirects](https://developers.cloudflare.com/pages/configuration/redirects/).
