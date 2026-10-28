# Local stack verification, October 28, 2026

Scope: roadmap [#27](https://github.com/Sammieblz/tholi/issues/27), based on
`23a6a42480aa22f1b496a49facba92aa43121742` and the issue branch's working changes.
This is development/PR evidence, not release certification. Extension/API
`0.11.0`, website `0.1.1` and existing archives remain unchanged.

## Environment and image compatibility

- Windows host with Docker Desktop 4.41.2, Linux Engine 28.1.1 and Compose
  2.35.1-desktop.1 on WSL2.
- Node 24.19.0 in the pinned Debian API image, UID 1000, read-only root filesystem,
  no Linux capabilities, no new privileges and temporary writable paths.
- The existing `build:api` completed using the root lockfile. Runtime installation
  selected production API workspace dependencies without a second dependency list.
- In a network-disabled hardened container, the service booted while imports of
  native SQLite, worker threads, Transformers and Tesseract were deliberately
  blocked. Its local health routes remained usable.
- With native imports allowed and existing model files explicitly mounted
  read-only, the real ONNX binding loaded and the legacy private API initialized
  its existing SQLite and default inference/OCR workers. Authenticated v1/v2
  health and readiness returned 200; shutdown completed.
- All five stable API entrypoints and their root-level chunks were present.
  Model assets, development esbuild, `.env`, `.git` and `.codex` were absent.
- Removed the baked `THOLI_SERVICE_PORT` so a platform-provided `PORT` can work
  without conflicting environment settings. The final image's actual default
  command returned readiness 200 both with `PORT=8080` and with no port variables
  (8788), in separate hardened, network-disabled containers. Compose retains its
  explicit local 8788 setting.

These one-off compatibility probes were removed after verification. Permanent
runtime regressions remain in the existing API test owners.

## Findings and corrections

The first fresh Compose run started PostgreSQL, Keycloak, Mailpit and the API and
passed repeat bootstrap/seed and PostgreSQL privilege checks. Host HTTP probes
then failed because this engine omitted published ports on containers connected
only to an internal network. Disposable minimal probes confirmed successful
in-container HTTP and refused host connections; the same container on a normal
bridge published successfully. Merely setting internal gateway mode to `nat`
did not fix publication. Probe containers and networks were removed.

The corrected stack adds one pinned, non-root Nginx gateway. Only that service
joins the host-facing ingress network and publishes loopback ports. Its four
destinations are fixed; application/database services keep their internal
networks. Configuration validation passed in the hardened gateway container.
Review checked forwarding headers, URI/Host preservation, lack of a forward
proxy, request-log suppression and bounded timeouts.

Review also corrected quoted dotenv project-name handling before teardown. The
CLI uses Node's dotenv parser and validates the resulting project name; it never
silently substitutes the default for a quoted valid value. Its permanent safety
regression covers the actual project and exact destructive confirmation.

## Current checks

| Check                                                     | Result                                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| API configuration and local-stack policy contracts        | Passed in the complete 408-test unit cohort                                                 |
| TypeScript and synchronized version checks                | Passed                                                                                      |
| Production application build                              | Passed; prepared artifacts subsequently passed the existing build-manifest verification     |
| Complete deterministic `test:ci` cohort                   | Passed: 408 unit, 47 core, 20 integration, 2 Firefox extension and 65 UI checks             |
| Fresh-volume default and optional-profile container smoke | Passed: all 10 checks, including S3 privacy and OTLP, with successful owned-project cleanup |
| Hosted Linux container job                                | Pending branch push and PR                                                                  |

The first application cohort had one five-second timeout in the unchanged
900-link jsdom discovery case while container work ran concurrently. It completed
in 1.35 seconds in the fresh cohort with no discovery-code or timeout changes.
All 408 unit checks passed in that cohort. The failed run is not certification.

That fresh application invocation passed the unit, core, integration and
Firefox groups, then refused to reuse an existing website server on port 5174.
The UI group used the documented `THOLI_UI_PORT=5188` override, leaving the
existing server untouched. It passed 64 cases and exposed one existing Firefox
sticky-header/radio interaction race. The exact unchanged case passed on its
focused repeat. The final complete cohort passed on the alternate port with
validation ID `5f636415-e367-4639-ba5f-7dfbf3f74443`. All five groups completed
successfully against the original, verified prepared artifacts.

The first optional-storage startup exposed an entrypoint/volume-ownership
mismatch: the image's `/data` belongs to UID 1000, while the overridden entrypoint
left root without capabilities needed to write that directory. The corrected
service uses its native entrypoint and explicit UID 1000 without extra privileges
or an initializer. A fresh named-volume startup probe passed. Vendor telemetry,
WebDAV and the unused admin UI are explicitly disabled.

The next storage probe exposed premature readiness: a fresh SeaweedFS filer
delays joining the master registry, while master HTTP health is already green.
After registration, the same gateway performed signed PUT/GET with exact content
and denied anonymous retrieval with 403. The health check was corrected to
require filer registration through the vendor's `cluster.ps` command; request
timeouts remain unchanged.

Container smoke writes separate, redacted `smoke.json` records under
`output/qa/local-stack/`, including source state, resolved configuration
fingerprint, image identities, individual outcomes and owned-project cleanup.
The CI artifact selects only those JSON reports, excluding any local credential
file retained after a cleanup failure. Earlier failed reports are retained as
their own runs.

The final run, `tholi-smoke-mvsnpjoe-275958d7`, completed from
`2026-10-28T21:58:58.526Z` to `2026-10-28T22:03:17.591Z`. All 10 checks passed,
and cleanup removed its containers, volumes, networks and generated credential
file. Its API image ID was
`sha256:06cd0bf9254763e080bf21ba1ca0c5766d7cc0263c5e4bdcba320a00f8b0db33`;
the tested Dockerfile SHA-256 was
`bc7c3d0db40cba76cefe40d5e20bfa558f64b7db9cd20b24f72761915ca832eb`.
This run includes the corrected filer-registry health check and platform-port
image configuration. No request timeout was increased to obtain the result.

## Remaining milestone boundaries

The API remains health-only. PostgreSQL application migrations/repositories are
#28, account login is #30, the independent durable worker is #32, and typed fake
and Gemini inference with enforced provider spending is #39. The current fake
setting selects a cloud-free policy; it does not advertise an inference endpoint.
The separate Gemini overlay fails startup even with opt-in/budget settings.
There are no paid provider calls, hosted deployments or production mail in this
verification. Native browser permissions, screen readers and signed-in product
journeys remain separate checks.
