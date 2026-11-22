# Zero-cost perception verification, November 22, 2026

Issue [#43](https://github.com/Sammieblz/tholi/issues/43) remains open. The maintainer
retained a USD 0 external-provider budget. The beta quality gate stays closed:
real structured/multimodal inference, independent held-out outcomes and the
90% grounded-step, 80% verified-completion and failure-set improvement decisions
are unavailable. This record does not replace the
[October evidence](perception-comparison-validation.md).

## Scope and provenance

Follow the [predeclared zero-cost protocol](perception-comparison.md#zero-cost-verification-november-22-2026).
One standalone Local baseline and nine separate fake-only cohorts were collected
at source `a476300bfd5e3d34170a5f5c4c7294bb02bf3ef1`. Each cohort used a fresh
local PKCE session, one-hour fake plan and separately closed accounting journal.
No failed tuple was retried. The later collector correction has separate evidence.

The installed Chromium version was **156.0.8078.4** on Windows x64, Node
**24.19.0**, Ryzen 7 2700X, 16 logical CPUs and 34,307,969,024 bytes of reported
memory. The comparison used actual native content geometry of 1280 by 900,
device pixel ratio 1 and visual scale 1. Every tuple had a disposable profile.
The existing grant-only manifest and native toolbar action were retained.
This does not verify native permission dialogs or native sign-in windows.

| Original-cohort identity    | SHA-256                                                            |
| --------------------------- | ------------------------------------------------------------------ |
| Source contents             | `d60a239f22f001ea91cf6d4c6d020a964155a7975611e0da09ee65828d399638` |
| Chromium build              | `38140e151861420098292b97563d23636be14dcae1a3ca27e61c09665d46ac87` |
| Build manifest              | `cb3584b58355ab7e1cdced3d436b88c33b0506e7f709ae773e2d3e820371793d` |
| Runtime permission manifest | `41c096c39a931147b2ce4e28c175f5aa3f3e9b81877fbdd33d7f364f7a15022f` |
| Prompt                      | `2a48b9960c4e1ed4775e1c93a2f120a2b907eaf0bfea113e8e909da99d2cf8d1` |
| Observation schema          | `f7eaa5c3ab55a0d963db4051576be19b8870b8780abbb0c14fa7d82a45418108` |
| Capture policy              | `13fec2783d37c0e4b3f8060c60d9c1f12c8870999a75a8285719892e57481429` |
| Protocol                    | `1911c7c62b5a398ab37ee034dd21610b0a07cef435e21b129abd82777e1ac199` |

The provider was `fake`, model `tholi-deterministic-v1`. Version-1 plan metadata
retains API `v1`, project `tholi-dev-ilunonsen`, location `global`, the historical
Vertex price revision and USD 4.90 allowance field. These unused live-profile
fields neither configure Vertex in this composition nor grant spending approval.
Fake reservations, settled cost and liability were USD 0. No Vertex approval file,
ADC session, provider keys or provider-egress profile was created.

The original corpus is unchanged at SHA-256
`1095f37ba0127937ee9ad327a49ee9170f9402cd2e13ea54d75a546e74cd8656`.
Windows CRLF checkout bytes for the fresh declaration, synthetic declaration
and oracle differ from the protocol's reviewed LF bytes. LF-normalized hashes
match the frozen values; `precollection-hashes.json` retains both forms.
Plans bind the actual checkout bytes, including fresh-declaration SHA-256
`55683d80b51795537c1426eb90158765085237b459862cecb712fe27163f7e27`.
Neither declarations nor outcome selectors were edited.

## Standalone Local baseline

The 18-case collector was run once. Its raw report is failed, with **7 completed,
9 measured navigation failures, 1 blocked and 1 unavailable**. Sixteen cases
have measurements. Zero false-success events were recorded within those sixteen;
this is not a claim about the unmeasured cases.

- Completed: `wiki-theme`, `wiki-width`, `wiki-references`, `wiki-search`,
  `wiki-languages`, `wiki-information` and `github-projects`.
- Measured navigation failures: `wiki-history`, `wiki-plot`, `github-issues`,
  `github-pulls`, `github-actions`, `github-security`, `github-license`,
  `github-contributing` and `github-releases`.
- Blocked: `github-insights`. The declared visible `/microsoft/vscode/pulse`
  oracle target was absent. No replacement target was selected.
- Unavailable: `wiki-text`, which reached the 90-second timeout without a
  measurement attachment. Its failing stage and root cause remain unknown.

All nine measured failures retained the target in the page snapshot; seven
retained it in the model projection. `github-contributing` and `github-releases`
did not. These observations narrow investigation but establish no root cause.
The repeated 7/18 count does not establish equivalence with October's cohort or
a causal before/after result.

Baseline run: `a607ddc9-fead-4006-a5f3-81cf2f83767a`, report SHA-256
`202debb1a07c9a4cccba2340dfc945b42cba59f8eeccb1c0721770c548b195e6`.
Its `full` tier is a focused baseline selection, not full release certification.

## Original nine-cohort coverage

Each row below has 30 selected tuples: 12 calibration cases, six synthetic cases
and twelve explicit `not-run` cases. Each individual report retains the complete
270-tuple configured denominator and 240 missing unselected tuples. Across the
coverage inventory there are 270 unique selected tuples, 162 eligible executions
and 108 explicit `not-run` rows. All 54 fresh-holdout rows remain `not-run`.
The other 54 `not-run` rows belong to previously inspected noncalibration cases.
The inventory is a coverage index, not a merged quality study.

| Arm/repetition | Measured | Blocked | Not run | Fake claims | Generation intents |
| -------------- | -------: | ------: | ------: | ----------: | -----------------: |
| Local/0        |       17 |       1 |      12 |           0 |                  0 |
| Local/1        |       17 |       1 |      12 |           0 |                  0 |
| Local/2        |       17 |       1 |      12 |           0 |                  0 |
| Structured/0   |       15 |       3 |      12 |          14 |                 13 |
| Structured/1   |       13 |       5 |      12 |          13 |                 13 |
| Structured/2   |       14 |       4 |      12 |          12 |                 12 |
| Multimodal/0   |        7 |      11 |      12 |           5 |                  5 |
| Multimodal/1   |        9 |       9 |      12 |           5 |                  5 |
| Multimodal/2   |        8 |      10 |      12 |           5 |                  5 |

All nine journals are closed, with zero unresolved generations, zero cost or
liability, zero CountTokens dispatch intents and zero known sentinel leaks.
Claims differ from authorized dispatches: a claimed generation can terminate
before exposure. All reports have `qualityEvidenceAvailable: false`.
Collector `passed: true` means the selected reporting process completed; it does
not mean every task navigated successfully or the provider was reached.

The browser guard retained all 270 content-free network attachments, plus the
18 baseline attachments, with zero known model/payment route blocks. Its scope
is browser-routable HTTP; extension service-worker HTTP is not intercepted by
that claim. Separate server evidence is the fake-only composition and its closed
journals. Public signed-out pages still require internet access.

## Findings and scoring correction

Public-page multimodal requests failed before fake-provider admission. Only
synthetic pages produced the five fake generations in each vision repetition.
Some public terminals have `CANCELLED`; others have no canonical error code.
The evidence does not identify a single capture/currentness failure cause.
Keep this as an unresolved readiness blocker. No masking, freshness lease,
timeout, native identity check or safety budget was loosened.

An independent collector defect was demonstrated in the original reports:
`wiki-search/multimodal/0` recorded a canceled terminal, zero provider exposure
and a completed navigation using the remaining Local hint. Other provider rows
also retained actions after error terminals. Those original provider target,
completion and disposition metrics are affected and cannot support quality or
provider performance claims. Their reports remain unchanged.

The correction at `84039d15cf7595238adad6bf9b1bfcf2176cc239` distinguishes a fresh
bound `terminal-error` from a usable provider terminal. The collector retains
generation/transport identifiers, error codes and decision latency, then stops
before any further oracle action. Invalid output remains invalid output; cancellation
never becomes intentional refusal or provider guidance. Stale, unrelated and
unbound processing metadata remain inadmissible.

The original reports retain accepted-target correctness, verification events,
negative dispositions, recovery, latency, device snapshots and full-attempt
journal accounting. No recovery episodes were measured. Known-sentinel checks
do not establish arbitrary pixel privacy. CPU deltas are unavailable where child
process identities changed; memory values are snapshots, not peaks. Fake latency
and USD 0 fake cost are not production Gemini latency or cost estimates.

## Validation and evidence retention

The original complete `test:ci` gate passed at `a476300b` under coordinated run
`aac4ae8b-01d3-4b9d-9630-99efd9a65ce4`: 1,376 unit cases and 177 browser/UI cases
(57 core, 20 integration, five Firefox, 95 UI). All eight reports have the same
run ID, PR tier and complete selection. The scoring correction separately passed
37 focused provider/comparison tests and whole-project type/version checks.

Current raw evidence is retained locally under
`output/qa/43-zero-cost-20261122/`: `baseline.json`, `baseline-summary.json`,
`baseline-triage.json`, `inventory.json`, the exact PR report archive and
`tholi-smoke-zero43-dfbc9d84/<arm>-<repetition>/`. Each cohort retains its plan,
collection report, closed journal, canonical audit and finalized report.
Private environment/session files are not publication artifacts.

The coverage inventory SHA-256 is
`2c54e0e1dfc49a9e78d65cbd42a4bdb1d5b891a9321c655e51031836c0e6b024`.
These digests identify the unchanged original files, including affected results:

| Cohort       | Plan SHA-256                                                       | Final report SHA-256                                               |
| ------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Local/0      | `b81236c246ebee21ac854099e64689105d6d0794de16200195e22e7c9edbcf3d` | `f656e4327905bdeba6222e9f373815ca2f485e51c04ca5cbe6cc5d6c9fa0f9b7` |
| Local/1      | `20e20e384fedbab1b9409a62c439047fac2bcd7508de93f805f84eb21decf16c` | `f46cb4f84775f1676d019d0e4eb5a82e59d90b26f8f14e67240bcb7a5b3395f3` |
| Local/2      | `aafec1f09d7d5a308fa00761e71b06ade30b70c700b6de02448d3f4df0e72148` | `4af31ee832c583f9e2cf88fa76ed5e03c815ff47ae557d446103835b8ad33c1f` |
| Structured/0 | `002a6b2a396176cfef23186755dada2cfe24600ed127e23569753d416f5c61bb` | `48abc1e2920f2beb1de6c5e89883d12bbf71f52c99375c75f4930333c863c319` |
| Structured/1 | `fffff6ae6d15d5ea1dce5b39e6db21d5cb2f28dd1d803e96205effb6d4e84736` | `498fc664c9541e049774e924da482c9331aff92a110536ecdab3ec9473b1e3cf` |
| Structured/2 | `c98d490b467ae2db63f40fe1aea8b6aacec6f8bf02e6c55aa38f12c69d7efe8b` | `66ec8d4c3cf8bb7b254c28cebba789de3674182f00d9c7b9f1dc0040615a8b75` |
| Multimodal/0 | `551c07a519a1fda7b2e7be5e62f97d03e9f29c3e141935383a468c6ea70cff7f` | `135955262d4a22355f8d44f948dfc3356723d32208e955a9763b0329375e401a` |
| Multimodal/1 | `6fd4c51fd99442784b56eac0f94e741440fbf79b04ea920ff85fe691bb14d225` | `3eca2a00401738b0328b1a4c1e66c42a2f0278d66662138bb1f675feea5869f6` |
| Multimodal/2 | `bb99ce16867f3c98c2d1859d8aed4c248e036d9871109ab2c7ed3aabeaa66684` | `03936bc2584ad640b7f6c0aac1d9284484ba73e7387d01af148a28ec96020418` |

Production model quality, independent held-out evaluation, native Firefox model
quality, macOS evidence, native permission prompts, screen-reader behavior,
full certification, packaging and deployment remain pending or separate gates.
Versions remain website 0.1.1 and extension/API 0.11.0. Desktop implementation
#54 and other repositories were untouched.
