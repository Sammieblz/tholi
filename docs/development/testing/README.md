# Testing and CI

Use Windows and Node 24.19.x. Install once with `npm ci` and `npx playwright install chromium firefox`.

| Purpose                                          | Command                                      |
| ------------------------------------------------ | -------------------------------------------- |
| Pure and DOM unit/integration contracts          | `npm test`                                   |
| Types plus fast tests plus production build      | `npm run check`                              |
| Deterministic PR validation, including one build | `npm run test:ci`                            |
| Complete certification, including one build      | `npm run test:full`                          |
| Focus a named browser project                    | `npx playwright test --project core-desktop` |
| Focus existing unit ownership                    | `npm test -- lifecycle.test.ts`              |

Existing focused `test:e2e`, `test:ui`, `test:nlp`, `test:multi-app`, `test:vision`, browser and live aliases remain available. Browser aliases expect `npm run build` first, including the prebuilt browser fixtures. Website and demo tests use production previews of the immutable build, without another compilation; coordinated runs reject an unrelated server on their configured ports. Focused UI, multi-app and reliability aliases retain their complete scope, including extended/performance cases; `test:ci` explicitly selects the fast tier. Unit tests default to Node; files that require DOM behavior explicitly select jsdom. Four Vitest projects (`unit`, `nlp`, `multi-app`, `vision`) and named Playwright projects are defined under `config/testing`; thin root entries support editor discovery. Types stay in root `tsconfig.json`; application Vite configs remain with their apps.

## Feedback versus certification

The [navigation baseline and perception comparison](navigation-baseline.md) is
the opt-in measurement protocol for roadmap #23. It reuses the installed-extension
harness and independent outcomes, and does not change release certification.

PRs and main pushes run types, fast contracts, deterministic extension/browser tests and focused website/layout coverage. Feature-branch pushes do not duplicate PR checks. Superseded PR runs are canceled. The aggregate required `validate` job fails when any dependency fails or is canceled.

The separate Linux `containers` job runs `npm run test:local-stack -- --optional`
against fresh local volumes and participates in `validate`. It builds only the
API container and does not duplicate the full application/model build. This
infrastructure smoke uses no paid accounts or external mail destinations. See
[local stack setup and safety](../local-stack.md) for prerequisites, retained-data
checks and redacted evidence. Ordinary unit runs do not need a Docker daemon.
The same job runs [service database checks](../service-database.md) against actual
PostgreSQL: upgrades, runtime privileges, scoped transactions, revision/credit
concurrency, backup/restore and reset. Its test image is separate from production.

Nightly at 06:00 UTC, manual full validation and version tags retain public-site journeys, frozen model/OCR benchmarks, busy-page/performance budgets and every responsive acceptance scenario. Public tests include the reported-page and language cases formerly hidden in the NLP browser folder. PR contexts reject unexpected public HTTP requests; explicitly fulfilled fixtures remain usable. The full coordinator applies the same fixture-only network policy to its local browser groups, enabling public access only for live-site and acceptance groups.

Each workflow builds extension, website, API and browser fixtures once. Core/integration groups start only the demo preview; UI starts demo and website previews; live-site groups start neither; acceptance starts only the demo needed by its local fixture. Parallel jobs download immutable artifacts and verify `output/build-manifest.json`, including pinned inference assets. Heavy model jobs stay isolated. npm downloads and verified pinned assets are cached; caches never replace hash validation. State reads are passive and bounded. Starting a browser fixture waits for both worker state and the panel ready controls. Headless exports use a shared browser-completion/file adapter; automatic-download prompts are explicitly pregranted in disposable profiles. Only the two export fixtures select Chromium’s disk-backed blob transport to avoid host memory-pressure starvation; performance profiles retain normal browser settings. Fresh profiles preserve test isolation, while extension files are shared. Fixture-only permission copies are created once per worker. Native grants still require manual verification.

## Evidence and packaging

Both reporters share case-completeness and build-provenance utilities. All collected required cases must run once and pass; missing, duplicate, skipped or failed cases cannot certify. Acceptance scenario IDs and thresholds remain frozen. The authored-state oracle runs once in unit coverage, independently of viewport.

Reports include `validation.tier`, `validation.runId` and `validation.buildDigest`. Full evidence must cover required projects, suite ownership, exact extension/API/website bytes and the same coordinated run. `test:full` verifies the completed graph; parallel full jobs merge only their owned reports before certification. `test:ci`, filtered runs and unrelated focused invocations cannot authorize packaging. Packagers never rebuild, overwrite archives or accept PR evidence. After a failed hosted full run, rerun all jobs: evidence from successful jobs in an earlier attempt cannot be combined with a new attempt.

Use `THOLI_UI_PORT=5188` to avoid another local preview. `THOLI_BUILD_PREPARED=1` is for already built, immutable artifacts, verified with the build manifest; it skips duplicate preparation. The runner writes task timings under `output/qa/timing-*`.

## Coverage and timing

See [the coverage ledger](../../releases/v0.10.1/coverage-ledger.md) for every merged/removed owner and preserved assertions, and [the cleanup report](../../releases/v0.10.1/repository-cleanup.md) for before/after evidence. The target is at most ten minutes on a warm hosted PR run, excluding queues. Local measurements do not establish hosted runtime; that remains pending until the revised workflow executes.

Retain permanent tests for distinct contracts or regressions. Search existing ownership first, improve it, remove temporary probes, and never remove a unique assertion to reach a test-count quota.

## Browser targets

The normal build creates both targets. `node scripts/test.mjs firefox` uses Selenium/geckodriver to execute installed Firefox. Resolution checks Windows App Paths, including Microsoft Store registration; `THOLI_FIREFOX_BINARY` selects an isolated official build if needed. Playwright Firefox projects test the website. Branded checks use installed Chrome/Edge and pinned official Brave portable (`npm run fetch:browser-tools`, or `THOLI_BRAVE_BINARY`). Disposable profiles never alter a user profile.

Full validation includes paired `browser-performance` measurements on the same hardware, with unchanged 750 ms warm planning, 2000 ms warm OCR and 1000 ms Stop limits. Cold timings and busy-page frames are reported without promising identical execution times. Both target digests, browser versions and one validation identity are required. Frozen acceptance IDs use shared contracts and independent oracles; pure engine/model tests run once.

Full acceptance has separate `acceptance-chromium` and `acceptance-firefox` owners, each covering both declared viewports and all frozen IDs. Nightly CI runs them in separate jobs and merges only matching run/build evidence. Locally, `node scripts/test.mjs full --group acceptance-firefox` runs that complete owner; the Chromium equivalent uses `acceptance-chromium`. The existing `test:acceptance` alias still runs both targets as a focused validation. Background memory assertions wait for durable state without adding persistence latency to navigation or Stop. Browser teardown has a separate thirty-second bound, and native Firefox timeouts clean up only identity-checked disposable profiles.

Gecko cannot intercept privileged extension contexts through BiDi. Deterministic website interception rejects public HTTP requests; packaged extension CSP/assets and private-settings boundaries are checked separately. Native permission prompts, screen-reader speech and signed-in workflows remain explicit manual checks.
