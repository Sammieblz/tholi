# Tholi 0.11.0 navigation reliability implementation record

Work date: 2026-10-18. Baseline: `854eb80`. This is an implementation and validation
record, not a claim of universal signed-in website accuracy.

## Changes and ownership

| Problem                                      | Change                                                                                                                        | Existing owner / regression coverage                                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Scan churn displayed as a task error         | Retained destination, fresh-scan retry and bounded pending-index recovery; native document/session rejection retained         | Journey service, plan lifecycle; live-navigation and lifecycle                            |
| Natural signup and punctuation misunderstood | Shared phrase normalization, auth aliases and protected quoted names/URLs                                                     | Task intent, Compromise, retrieval; natural-language, dashboard-navigation and real-model |
| Repeated sidebar/menu guidance               | Live route/selected/open-state reconciliation, foreground surface ranking, destination deduplication, bounded action attempts | Navigation core/workflows; dashboard-navigation and workflows                             |
| Hidden destinations abandoned                | Grounded account-menu exploration also supports authentication intent                                                         | Exploration; dashboard-navigation                                                         |
| Manual-only menu interaction                 | Optional assisted navigation with worker and fresh-DOM gates, default off                                                     | Shared safety policy, UI, content; widget-lifecycle, lifecycle and browser conformance    |
| Stale inference and competing suggestions    | Shared bounded priority queue, one active CPU call, cancellation and latest-context replacement                               | NLP worker and API; local-model                                                           |
| Low-evidence OCR ignored foreground surfaces | Full-image privacy masks followed by optional menu/dialog region recognition, viewport fallback                               | Visual guidance / vision engine; real OCR integration                                     |
| Repeated unreliable route edges              | Idempotent timeout confidence penalty on existing observed edges; verified success decays penalty                             | Site memory / route graph; task-journey                                                   |

The MiniLM and Tesseract weights, frozen input corpus, acceptance goals, thread
count and safety budgets are unchanged. Selenium remains browser validation
infrastructure; it is not shipped as a second runtime crawler. Paddle remains
experimental. No LLM, backend or remotely executed code is required.

## UI guidance

Applied the local [UI UX Pro Max skill](../../../.codex/skills/ui-ux-pro-max/SKILL.md):
visible checkbox label, associated helper text, existing tokens, native keyboard
behavior and a 44 px label target. Targeted database searches for automation and
checkbox guidance returned no verified relevant match after the retry; these are
the skill's general baseline recommendations, not claimed search results.

## Pre-version validation on 0.10.1 artifacts

The following measurements were collected before the 0.11.0 version bump. They
remain tied to the original 0.10.1 artifact digests and do not certify this release.
See [0.11.0 validation](validation.md) for current-version status.

The regression owners were extended rather than copied into a parallel suite.
New cases cover distinct queue cancellation, guarded assistance, suggestion/task
separation and a layered deployment screen. Frozen fixture and model bytes,
acceptance goals and thresholds were not edited. Legacy test-side retries for the
old scan-change error were removed: recovery belongs to the runtime now.

Firefox test installation uses WebDriver BiDi's local-directory installation,
supported by the installed Selenium version, instead of the deprecated classic
method that ZIPs and base64-encodes model assets in memory. This followed a real
out-of-memory installation failure; both native conformance cases subsequently
passed. See [Selenium's extension API](https://www.selenium.dev/selenium/docs/api/javascript/WebDriver.html#installWebExtension).
This changes disposable test setup, not shipped permissions or the engine.

Chromium setup now cleans up a partly initialized profile even when startup fails
before its factory returns. The keyboard accessibility oracle brings its test
panel tab to the foreground while retaining the existing sidebar-harness website
context. Held context now retains live session updates rather than freezing a
session snapshot. A background tab cannot satisfy real focus assertions; the
assertions themselves remain intact. Startup/disposal timeouts, a trace export
failure following an active-test source edit, and interrupted runs were discarded
as certification evidence. The final complete core run used unchanged files and
normal tracing and passed all 47 cases.

### Final prepared-build results

Run: `navigation-2026-10-18-final-v5`. All PR groups ran against the same verified
build manifest; the full-tier model and paired-performance groups used those same
artifact bytes. Counts are diagnostic, not new hardcoded gates.

| Check                                                   | Result                     | Local wrapper time         |
| ------------------------------------------------------- | -------------------------- | -------------------------- |
| TypeScript; extension, API, website and fixture builds  | Passed                     | Build preparation separate |
| PR unit group                                           | 293 passed across 35 files | 63 s                       |
| PR core browser group, desktop and focused narrow cases | 47 passed                  | 321 s                      |
| PR specialized browser integration                      | 20 passed                  | 119 s                      |
| PR native Firefox extension conformance                 | 2 passed                   | 34 s                       |
| PR extension and Chromium/Firefox website UI            | 32 passed                  | 149 s                      |
| Full-tier NLP, multi-app and vision integration         | 11 + 17 + 4 passed         | 60 s combined              |
| Paired Chrome/Firefox performance                       | 1 passed, both targets     | 87 s                       |

All **394 PR cases** passed by their existing group owners. The specialized model
checks cover unchanged 200-case NLP, 360-case multi-app and 64-case vision inputs.
The NLP benchmark reported precision/coverage 1.0, zero false completions and zero
boundary bypasses. Multi-app held-out precision/coverage was 1.0 on five platforms
and 0.9643 on GitHub; one held-out target mismatch remains. Existing thresholds
were retained. No LLM calls were required.

Evidence remains local under `output/qa`, `output/nlp`, `output/multi-app` and
`output/vision`. Final target digests:

- Chromium: `c8fd064f89fb3299daa4b7c07d4129bfef8873b77ab5579c18a2736880602068`
- Firefox: `0611016fea6cd6ca382304507ba3c5023dfd0602157a94b3568713c15f4c97c9`

### Measured browser limits

Same Windows laptop: AMD Ryzen 7 5700U, 16 logical CPUs, 7.4 GiB RAM, Node
24.19.0. Both browsers used the bundled q8 MiniLM and single-thread WASM settings.
Planning measurements include extension transport for the fixture's search goal;
they are not universal complex-workflow latency guarantees.

| Browser              | Cold planning | Warm planning p95, 20 samples | Cold OCR | Warm OCR p95, 10 samples | Stop  |
| -------------------- | ------------- | ----------------------------- | -------- | ------------------------ | ----- |
| Chrome 155.0.8059.41 | 1211 ms       | 137 ms                        | 940 ms   | 585 ms                   | 84 ms |
| Firefox 158.0        | 1075 ms       | 134 ms                        | 869 ms   | 585 ms                   | 39 ms |

Both targets met unchanged warm-planning <750 ms, warm-OCR <2000 ms and Stop
<1000 ms gates. Whole-browser working-set samples after planning were about
906 MiB in Chrome and 1158 MiB in Firefox; after OCR, 1023 MiB and 1039 MiB.
These include browser/UI processes and are neither isolated model memory nor a
complete peak-memory profile.

The 50,000-node stress scene retained the same highlight, but frame p95 was
283.5 ms in Chrome and 200 ms in Firefox. **Busy-page rendering still has long
frames.** Passing the existing timing and highlight gates does not establish
smooth rendering or identical memory use. Earlier runs experienced severe host
memory pressure; their startup/teardown failures are not successes.

The core group took 5.3 minutes locally. Hosted CI timing and its warm-cache
10-minute target remain unverified; local groups were run sequentially while CI
uses parallel jobs.

### Remaining verification

This is not a complete `test:full` release certification. The public live-site
acceptance matrix, complete responsive matrix, fresh Edge/Brave installation
checks, native permission UI and screen readers were not all rerun in this pass.
Signed-in Cloudflare/GitHub/Amazon journeys need separate live verification.
The new deployment regression uses a controlled layered DOM fixture. Optional
assistance cannot guarantee a synthetic click is accepted by every site.

Both unpacked targets were rebuilt, and the local website remains on port 5174.
No release archive was replaced, signed, published or deployed. Packaging remains
subject to the complete existing gates; PR evidence cannot authorize a release.
