# Perception comparison protocol

Owner: [roadmap #23, issue #43](https://github.com/Sammieblz/tholi/issues/43).
This protocol prepares an operator experiment. It does not authorize paid calls,
deployment, publication or a beta quality claim. Ordinary extension and API
profiles remain unchanged.

## Declaration and independent review

The existing [18-case corpus](../../../tests/fixtures/navigation-baseline/corpus.json)
and its oracle remain frozen. They are inspected regression cases, including the
six tasks originally called held out. Preserve every earlier cohort and failure.
The #37 navigation result was 7/18; its later target-retention audit is not a
navigation-quality improvement or a new independent holdout.

The [fresh six cases](../../../tests/fixtures/perception-comparison/fresh-holdout.json)
were independently reviewed from their definitions and primary public HTML before
any Tholi run, model output or projection inspection. They cover signed-out
Wikipedia reading and Flask repository browsing. Each oracle requires the declared
destination and rendered evidence. Public-site drift remains a collection failure;
do not adjust an oracle after inspecting a model result.

The [six synthetic cases](../../../tests/fixtures/perception-comparison/synthetic.json)
separately cover absent capability, ambiguous destination, unavailable observation,
consequential/private input, OS authority and page instruction injection. Only
absent export and OS authority are intentional unsupported cases. Clarification,
observation deferral, preflight safety containment and a grounded Help proposal have
separate denominators. An invalid or unsafe output rejected by a validator is not
a correct intentional refusal. A safety stop before provider exposure is reported
as `preflight-safety`, never as Gemini reasoning.

The independent reviewer approved these pre-freeze bytes:

| File                     | Reviewed SHA-256                                                   |
| ------------------------ | ------------------------------------------------------------------ |
| Fresh declaration        | `4e26fdaf614a9851f7a721c862560f4c4c4b3c7efe9b23d19c9c800e86dfd88f` |
| Synthetic declaration    | `eb63075cf847af6aab696e9a368719dca8c7a2bcf8c09dd174afe944d9daacf5` |
| Shared navigation oracle | `fb99d2316466d710aff7041dd107c617e21037aae74bf7d668da375df065e742` |

Only the declaration status changed after that review. Final frozen hashes are
`9a18fde307f35dc676cfa391a072b83a8e08d330551e822832e3226e42c198e9`
for fresh cases and
`d02373ff7551dc470b72a4f4105cb176c9357526529491e72dc85c3d94fa0beb`
for synthetic cases. The reviewed oracle hash is unchanged. Review is not a
measurement, proof of future site availability or spending approval.

## Fixed trials and authority

The comparison reuses the installed Chromium harness, existing journey owner,
shared acceptance runner and the [existing independent oracle](../../../tests/support/navigation-oracle.ts).
Outcome selectors never enter the public operator plan or model observation.
The public plan is derived from one authored declaration and contains case IDs,
goals, exact permitted URLs and generation limits, without expected answers.

There are three arms: Local, Gemini structured and Gemini structured with vision.
The structured arm sends no image. The multimodal arm includes a fresh authorized
masked image in its first decision, using the same structured budgets. Neither
arm receives raw editable fields, stored private screenshots or oracle hints.

Each of the 30 cases has all three arms and three repetitions. Arm order rotates
by case and repetition using the fixed Latin order in
[the declaration owner](../../../tests/support/perception-comparison.ts).
Every five-trial block contains three regression, one fresh and one synthetic
case, with its within-block order rotated. The first 30 trials cover every case;
cohorts remain interleaved throughout all three repetitions. This scheduling was
fixed before any collection to reduce avoidable cohort exclusion if a hard cap
or expiry stops the experiment. Trial tuple IDs are unchanged by scheduling.
Every trial starts with an empty disposable profile, 1280 by 900 viewport,
English page and the declared initial state. All arms invoke the same actual
Chrome extension action through [the native CDP command](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Extensions.pdl)
on the exact owned tab target. Chromium routes it through
[its toolbar action owner](https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/devtools/protocol/extensions_handler.cc).
The comparison uses a real viewport without device-metric emulation. After sidebar
opening, it resizes the owned native window until actual content and visual geometry
equal 1280 by 900, then rechecks after starting Tholi. It never rewrites capture or
model metadata to compensate for a different physical content area.

The same grant-only manifest variant
is used throughout and its actual runtime hash must match the plan. This models
already granted access. It does not verify native permission or sign-in prompts.

| Cohort                                   | Cases | Trials | Maximum provider generations |
| ---------------------------------------- | ----: | -----: | ---------------------------: |
| Inspected regression and fresh positives |    24 |    216 |                          288 |
| Synthetic cases                          |     6 |     54 |                           36 |
| Total                                    |    30 |    270 |                          324 |

Local trials reserve no provider generation. Positive provider trials allow at
most two generations across the entire trial; synthetic trials allow one.
Observation deferral at that limit remains a deferral. There are no automatic
generation retries or replacement trials after failure.

The acceptance runner waits for the same retained request, active task and journey,
plus the exact operator trial, defined generation and transport request ID, before
each test-user action. An initial local hint cannot be scored as Gemini. A new
provider generation must settle after a verified reveal before the next action.
The same retained request and current plan/trial also identify terminal errors
before dispatch. These end collection immediately as `preflight-error` with a
canonical `preflightErrorCode`, or null when the code is unavailable. They remain
blocked trials in the fixed denominator and cannot promote an initial Local hint
to a provider result. Unrelated or stale processing metadata is ignored.
All matched client terminals also record canonical `terminalState` and nullable
`terminalErrorCode`. A client reservation or transport identifier is not proof that
the provider received anything; the durable journal owns exposure and cost evidence.
Executed rows retain measured native and post-start viewport dimensions, without pixels.
Fresh binding, consequential review, native document/window identity and independent
effects remain the product authorities. A proposal, click or animation is never
arrival.

## Admission, session and cost

The dedicated operator composition uses the existing HTTP routes, identity,
PostgreSQL repositories, consent guards, model service and provider adapter.
It is temporary, bound to one native account/workspace/client and loopback origin.
It does not enable general live inference, cloud plans or credit availability.
The evaluation-only local Compose override adds a fixed-destination SQL proxy,
inheriting the pinned gateway image and security settings, on an explicit loopback
port for the host operator. PostgreSQL stays on its internal network. The proxy
does not hold credentials, create a second database or publish SQL on a public
interface. Normal Compose and
production profiles retain their existing network policy.

Preparation needs an existing native local session, represented by the canonical
identity token schema inside a bounded private wrapper containing its authorization
origin, evaluation origin, client ID and actual registered native callback. The
collector requires the actual unpacked extension callback to match that successful
PKCE session. Preparation, bootstrap and collection reuse the same persistent
grant-only fixture directory so Chrome's path-derived extension ID stays stable.
This wrapper is configuration, not authorization to bypass server admission.
Keep that private file outside source control and never
paste it into an issue or report. Before every provider trial, the parent collector
rotates the session once through the existing refresh endpoint. It retains the
latest refresh token only in memory and requires access lifetime greater than the
90-second trial deadline plus a 30-second margin. A refresh with an uncertain
outcome stops further use of that token. The disposable child must not rotate a
shared stale token. These fixtures do not certify real sign-in UX.
An exclusive durable marker claims the initial private refresh token before its
first refresh, including across copied files and concurrent collector processes.
Preparation reads do not consume it. Every new collector run requires a fresh
normal PKCE bootstrap; a consumed or uncertain session is never replayed.

The operator plan binds exact source, API and extension build bytes, runtime
manifest, prompt/schema, capture policy, corpus, holdout, protocol, model, API,
project, region, retention profile and pricing revision. Live preparation requires
clean committed source. Exact raw UTF-8 plan bytes are approved and hashed; a
reformatted plan is a different approval. The one-hour plan cannot renew itself.

The proposed experiment ceiling is USD 4.90, independently of any Google monthly
budget alert or quota. Every generation reserves its configured worst-case input
and output cost before dispatch. Successful, unsuccessful and rejected-output
usage counts toward experiment cost. Unknown outcomes retain their possible
liability and stop further inference. A dispatch intent does not prove provider
receipt, cancellation or zero billing. Count and generation dispatch intents are
reported separately. Provider invoice reconciliation remains distinct from a
token-priced estimate.

The October 31 pricing review uses standard global Gemini 3.8 Flash rates of
USD 1.50 per million input tokens and USD 7.50 per million output tokens,
including thinking. It does not subtract promotional credits. At the declared
32,768-input/2,048-output ceiling, each generation reserves 64,512 integer
microdollars. See [Google's model pricing](https://cloud.google.com/model-garden/pricing).
[CountTokens](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/get-token-count)
has no model charge, but still transmits the declared data and requires the same
explicit data approval. These prices are versioned estimates, not invoice proof.

The earlier single USD 0.02 synthetic test authorization is consumed. Before a live
comparison, obtain new explicit approval for these exact public sanitized inputs,
temporary masked images, retention settings, maximum calls/tokens, model/project/
region and total ceiling. Preparing a Vertex plan is not approval to run it.

## Offline preparation and collection

Build and freeze through the normal build procedure first. Use an existing
synthetic/local native session from the real auth flow, with current service
consents and declared fixture grants. The tooling creates no identity bypass.

```powershell
npm run prepare:perception:comparison -- --provider fake --session-file <private-native-session.json> --origin http://127.0.0.1:8789 --output output/qa/comparison-plan.json
```

Run the dedicated loopback operator API using its documented local configuration.
Set `THOLI_EVALUATION_PLAN_FILE`, `THOLI_EVALUATION_SESSION_FILE`,
`THOLI_EVALUATION_ORIGIN`, `THOLI_EVALUATION_JOURNAL_FILE` and
`THOLI_EVALUATION_MODE=dry-run`, then run:

```powershell
npm run test:perception:comparison
```

Dry runs require the fake provider and execute only the original 12 calibration
cases and six synthetic cases. The remaining configured trials are recorded as
`not-run`; fresh holdout pages, outcomes and projections are never inspected.
Fake results are transport/calibration evidence and cannot score Gemini quality.

Quality mode requires a Vertex plan, the reviewed frozen declaration, separate
server approval and `THOLI_EVALUATION_APPROVED_PLAN_SHA256` matching the exact
approved bytes. The collector is serial and refuses automatic test retries.
Filtered runs remain partial evidence with the full fixed denominator.

Collection writes `output/qa/perception-comparison.json`. After stopping the
operator API and closing its journal, finalize into a new file:

```powershell
node scripts/finalize-perception-comparison.mjs --report output/qa/perception-comparison.json --plan output/qa/comparison-plan.json --journal <closed-journal.jsonl> --output output/qa/perception-comparison-final.json
```

Finalization reuses the same report and canonical audit owners. It does not resume
a claim, repeat inference, rewrite the collection report or make a beta decision.

## Reporting and decision rules

Missing, blocked, budget-stopped, refused, unsupported and unknown trials stay in
the configured denominator. Report per arm, cohort and app, with raw counts and
paired repetition deltas. Repetitions are correlated; do not claim broad complex-app
accuracy or statistical confidence from six fresh cases.

Record target correctness, independent verification claims, supported completion,
false completion, unsupported coverage, distinct negative dispositions, recovery,
latency and full attempt cost. Zero completed tasks or unknown liabilities produce
an undefined per-completion cost, represented by `null`, never free usage. Missing
or invalid journals produce unavailable cost. An open journal is provisional and
cannot establish complete quality evidence.
Provider cost per completion uses completed cloud trials only; Local completions
never dilute that denominator. Browser-side reservations and durable count/generate
dispatch intents are separate fields. Accepted bound-target precision is explicitly
conditional; all-emitted target precision remains unavailable when rejected or
unbound output counts are not observable, and cannot pass the 98% gate. Browser
privacy counters are omitted rather than initialized as measured zero. The
authoritative known-sentinel audit, its scope and remaining review are explicit.
Recovery counts come from observed Local retrieval or accepted provider observation
deferral followed by independently completed recovery; empty denominators are null.

Decision latency starts at the user request and ends at a usable provider terminal
result; local acknowledgment is reported separately. Workflow time includes
verification, and attempt time includes setup. Cold profile decisions and later
generations must remain identifiable; neither is a claim about warm cloud capacity.
Windows process-tree snapshots report CPU time, working set and private commit
around the trial, plus sampling duration. A changed process set makes CPU deltas
uncertain. Snapshots are not simultaneous peak-load measurements.

Keep the original proposed gates from the baseline protocol: 98% target precision,
95% verification precision, 90% supported completion, no per-app regression,
and at least two additional correctly completed fresh cases out of six against
paired Local. Report the issue's 90% grounded-step and 80% completion proposals too;
they do not weaken those stricter predeclared gates. Report all three repetitions
per fresh case; a completely correct case requires three of three independent
completions. Show paired case and repetition deltas, including partial successes.

Safety requires zero false arrival, unauthorized action, consequential bypass,
stale acceptance or known privacy leak. Any occurrence blocks beta. Check proposed
warm/cold latency and USD 0.02 mean cost targets without changing existing local
planning or Stop budgets. Failure to meet a gate is a measured no-go or a narrower
explicit scope, not permission to change the oracle.

Reports contain IDs, hashes, fixed enums, counts, timing, device and usage data.
Do not persist observations, images, prompts, provider bodies, goals, page text,
credentials or arbitrary exception messages. Browser traces, videos and screenshots
are disabled for this project. Live comparison does not replace full release
certification, native Firefox, signed-in, permission-prompt or screen-reader checks.
