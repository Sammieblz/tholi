# Navigation baseline and perception comparison

Owner: [roadmap #23, issue #24](https://github.com/Sammieblz/tholi/issues/24).
This protocol is separate from [release acceptance](acceptance.md). It does not
change an existing corpus, threshold, release gate or product behavior.

## Scope and safety

The [18-task declaration](../../../tests/fixtures/navigation-baseline/corpus.json)
uses public English Wikipedia and the public Microsoft VS Code GitHub repository.
It measures signed-out reading, finding controls, changing local appearance and
opening public destinations. Those tasks fall within the issue's read-only
reproduction scope. No issue, comment, account, repository or payment is created.
Do not enter credentials, submit forms, edit remote content or use a personal
browser profile. Opening a history or information page is not editing it.

Each task starts with a fresh disposable profile and empty Tholi knowledge at
1280 by 900. The baseline uses the real packaged Chromium extension, bundled NLP
and normal journey owner. It does not use the zero-embedding fixture engine.
On-device experimental LLM, assisted navigation and the optional backend remain
disabled. The browser harness invokes user interactions after checking guidance;
these are not Navigator automation or evidence of success.

GitHub access is pregranted with the existing disposable permission-variant
helper. The original packaged manifest and host grants stay unchanged. Every
measurement checks the runtime manifest against that exact declared variant and
records the extra origins and runtime-manifest hash. Enclosing build hashes refer
to the original build; the variant differs only in its declared test grant. This
models already authorized website access and does not test the native permission
prompt or toolbar activation.

Signed-in GitHub, Jira, Cloudflare and desktop-window workflows need a separately
approved experiment. This public baseline cannot establish their quality. Native
Chrome, Firefox, native permission prompts and screen-reader checks remain
pending until performed on those targets.

## Reproduce the local baseline

Use the Node and browser setup in [testing and CI](README.md), then run:

```powershell
npm run build
npm run test:navigation:baseline
```

The alias selects an opt-in project in the existing Playwright configuration.
The normal live and full-certification groups exclude this experiment. It reuses
the installed-extension harness, acceptance runner, outcome contracts and build
provenance reporter. It writes `output/qa/navigation-baseline.json` with each
case's measurement attached. A filtered invocation is exploratory only; an
initial baseline must account for all 18 declared IDs exactly once.

The collector's `passed` field means measurement collection succeeded on unchanged
build bytes. Inspect `measurement.navigation`, `result.completed` and independent
outcomes for navigation quality. A recorded navigation failure is valid baseline
data. A missing target, blocked site, page-load error or harness-startup error
fails collection and remains an infrastructure failure in the fixed denominator.
Do not substitute a fixture, remove a task or change a selector after inspecting
model results. A public-site redesign requires a new versioned declaration and
an explanation of the invalidated comparison.

Each record includes the initial state, request, declared independent target and
outcome, split, actual browser version, viewport, source revision, dirty-tree
flag, corpus hash, extension artifact hashes through the enclosing report,
planning/attempt timing, local outcome and stage diagnostics. Preserve failed
runs alongside successful reruns, with their distinct identities. Do not relabel
previous release reports. No page bodies, editable contents, credentials,
screenshots or screenshots of private sessions belong in this report.

`initialPlanMs` measures the first acknowledgement, which can precede usable
guidance. `elapsedMs` includes page setup and verification. Neither is isolated
inference latency or evidence that the proposed latency gate has passed.

## Independent outcomes

The test declaration owns selectors and expected destinations. They never enter
product code, prompts or inference inputs. A correct label alone cannot establish
the correct destination. The acceptance runner also checks the declared origin
and path for the new navigation cases before interacting.

| Task family                   | Initial state                                        | Outcome independent of Tholi                                  |
| ----------------------------- | ---------------------------------------------------- | ------------------------------------------------------------- |
| Wikipedia text/theme/width    | Explicit different radio choice, Appearance restored | Actual requested radio checked                                |
| Wikipedia section             | Document top                                         | Named heading fully within the viewport                       |
| Wikipedia search              | Search unfocused                                     | Actual search field is `document.activeElement`               |
| Wikipedia languages           | Picker closed                                        | Actual language picker visible; Tholi awaits choice           |
| Wikipedia history/information | Article reading view                                 | Actual origin, declared action query and visible main content |
| GitHub navigation             | Repository Code page                                 | Exact declared URL path and visible main content              |

Every supported task remains in the completion denominator when Tholi refuses,
times out, chooses incorrectly or reports an unsupported request. A click, changed
URL alone, model proposal, focus ring or animation is insufficient. The reused
acceptance runner also checks retained-request progress and independent effects.

## Diagnose by existing ownership

Use the earliest demonstrated failure. A later timeout is often a symptom.

| Stage          | Required evidence                                                                                          | Existing owner                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Discovery      | Oracle target exists, but complete scan lacks the eligible control                                         | `packages/page-discovery` accessibility, structure and incremental index    |
| Projection     | Discovered target or needed region is absent from a bounded observation/model input                        | `PageDiscovery.snapshot` coverage; `packages/goal-planner/model-context.ts` |
| Interpretation | Correct target is available, but a different meaning/target is selected or request is refused              | `packages/nlp`, `packages/navigation-core`, `packages/goal-planner`         |
| Binding        | Correct live control selected, but freshness/eligibility/overlay points to the wrong element or fails      | Content `PageCoach`, discovery bindings, browser geometry/overlay           |
| Verification   | Independent requested effect occurs without retained-request progress, or completion is claimed without it | Content verification; background session/journey acceptance                 |

The collector stores snapshot counts, partial status and coverage, plus expected
target presence in the existing model projection. That projection is a diagnostic
of the future structured input, not proof that the current local planner used it.
An absent target on a partial scan is `discovery-or-projection`, not a guessed
root cause. The model's 96-control projection is separate from the 600-control
page snapshot. Missing context can fail even when a target is retained.

Automatic classifications are triage suggestions. Review the measurements before
recording a root cause. Use the existing overlay inspection helper for a suspected
binding failure and an isolated reproduction for exact discovery/projection
ownership. Remove temporary probes after analysis. Do not fix navigation or tune
the local model in this baseline issue.

## Frozen comparison design

The declaration and its SHA-256 are checked in before inference work. It has
12 calibration tasks and 6 held-out tasks, balanced across both apps. All may be
measured once with the unchanged local baseline to identify current failures.
Never use held-out outcomes to tune prompts, retrieval, app rules or thresholds.
If that occurs, mark the split contaminated and author a new, independently
reviewed holdout before claiming comparative gains. Existing frozen NLP,
multi-app, continuity, vision and Wikipedia corpora remain unchanged.

Later issue #43 compares three arms on the same tasks, build, browser, hardware,
viewport, initial state and independent outcomes:

1. **Local:** bundled NLP, no backend or LLM. The issue #24 records are the initial
   baseline; rerun on the comparison build so code drift cannot explain gains.
2. **Gemini structured:** the versioned sanitized, bounded observation, no image.
3. **Gemini structured and vision:** identical structured input plus a fresh,
   authorized, masked viewport image. Editable fields and iframe pixels stay
   masked. No raw capture is persisted or reused across document revisions.

Pin exact model ID/version, prompt hash, observation schema, projection limits,
provider settings and client/backend source bytes before held-out runs. Use the
same observation budget for both Gemini arms. Counterbalance arm order and run
at least three paired repetitions. Keep cold and warm timings separate, record
site changes, and never replay private screenshots. The backend remains a proposal
source; only fresh local bindings and independent effects can advance a journey.
Browser-window or cross-frame context needs explicit authority and its own cases.

Only the local arm is runnable in this issue. Implement provider arms through the
planned contracts and adapters (#36 through #41), not a second inference client in
the test harness. Fake inference validates transport and quotas; it cannot score
Gemini navigation quality. Live Gemini needs explicit experiment and spend
authorization. Containerized hosting does not make inference free.

## Proposed gates for issue #43

These are predeclared proposals, not measured results or release certification.
Review affordability and sign off before any paid comparison; do not adjust gates
after looking at holdout outcomes.

| Measure                | Proposed decision rule                                                                                                                                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Safety                 | Zero false completion, unauthorized action, consequential-action bypass, stale-document acceptance or known sentinel leak. Any occurrence blocks beta                                                                                                          |
| Target precision       | At least 98% across all emitted targets, reported as numerator/denominator per app and arm                                                                                                                                                                     |
| Verification precision | At least 95%; additionally zero false final success. Report actual claims, not suggested clicks                                                                                                                                                                |
| Supported completion   | At least 90% overall and no per-app regression against paired local measurements; report refusals, stops and infrastructure failures                                                                                                                           |
| Useful gain            | At least two additional correct held-out tasks out of six versus local, without a safety regression; expand the sample before a paid-rollout claim                                                                                                             |
| Latency                | Proposed warm decision p95 at most 3 seconds, cold p95 at most 8 seconds; measure user-visible full workflow separately. Existing local 750 ms planning and Stop budgets stay unchanged                                                                        |
| Cost                   | Proposed mean at most USD 0.02 per completed task and total experiment allowance at most USD 5, with server hard stop. Charge unsuccessful attempts to experiment cost; record input/output/image tokens, calls, retries and current provider pricing snapshot |
| Reliability            | Preserve interrupted flows, local fallback and bounded retry. A quota refusal or provider outage cannot become a completion claim                                                                                                                              |

With six held-out cases, a percentage is coarse and repetitions are correlated.
Report raw counts, paired deltas and uncertainty; do not market statistical
confidence or general complex-app accuracy from this pilot. A cost denominator of
zero completed tasks is undefined, not free. Infrastructure failures require
investigation and a fresh labeled run, not silent exclusion.

## Evidence and handoff

Keep a dated [baseline record](navigation-baseline-2026-10-27.md) alongside this
protocol. It must identify the exact source/build/corpus, every declared task,
failures with stage evidence, reproduction commands and pending checks. It may
link ignored raw output, but the reviewable counts and limitations belong in the
repository. A partial or blocked reproduction must remain explicitly incomplete.

Issue #25 may adopt service contracts after this evidence is reviewed. This issue
does not add production auth, plans, credits, PostgreSQL, cloud provisioning,
model calls or desktop permissions. Those remain sequential roadmap work.
