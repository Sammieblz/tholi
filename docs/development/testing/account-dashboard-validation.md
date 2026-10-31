# Account dashboard validation

Roadmap [#60](https://github.com/Sammieblz/tholi/issues/60). This record belongs
to the account workspace change after #59 merge
`cb57ea625335a6fc57a391246fb8f37958c70993`. Earlier saved-data, identity and plan
reports retain their original scope. Website 0.1.1 and extension/API 0.11.0 are
unchanged. No publication, paid calls or deployment is included.

## Guidance applied

- `.codex/skills/ui-ux-pro-max/SKILL.md`, manifest revision
  `7246805992a42b7bba37d4cac83b01416f0c6c44`: retain Tholi's actual tokens,
  typography and layout; use clear async state, concrete quantities and explicit
  destructive confirmation. Marketing layout suggestions from the skill's
  general search were not applied to this private workspace.
- `.codex/skills/fixing-accessibility/SKILL.md`, manifest revision
  `fdd6c09dd866354a627ddf3fa46b7b01d421176d`: native links and buttons, visible
  focus, labeled fields, announced errors/status, generous targets and existing
  Base UI confirmation semantics. Provider-managed authentication permits normal
  password-manager and paste behavior.
- Existing PostgreSQL repository and private-file owners remain authoritative.
  No second account provider, credit ledger, file worker or saved-data cache was
  introduced. Migration 010's exported SQL checksum remains unchanged; new SQL
  belongs to migration 011.

## Focused feedback

| Run                                    | Observed result and scope                                                                                                                                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `02a1344d-a8d9-4a91-9a62-73163afccd33` | 114 identity/config checks passed before later shared-contact extraction. An earlier sandbox startup failure collected no tests.                                                                                                                                    |
| `0d4e838a-75c7-4873-b1e0-ece7611b751a` | 23 profile HTTP checks passed at that source state.                                                                                                                                                                                                                 |
| `954e21bb-1ddb-4fa0-953b-2ef25d212967` | 20 account/support application checks passed before final HTTP composition and principal projection.                                                                                                                                                                |
| `6841655d-8979-413d-87d1-3d91fdeb8339` | 20 finance, saved-data and cloud-store checks passed before later focus refinements.                                                                                                                                                                                |
| `155f3d1b-2858-4106-ae4b-33725998e930` | Three finance UI checks passed, including unavailable states, exact quantities and Free enrollment without checkout.                                                                                                                                                |
| `b13b532c-4f89-448f-81f3-82afef3abc62` | Four saved-data UI checks passed after correcting focus restoration and late save completion. Earlier locator/disabled-focus feedback is not reported as passing evidence.                                                                                          |
| `1ca8e49d-ccff-46d3-803d-54da668c09b6` | 14 account/lifecycle checks passed: stale callbacks cannot call transport or erase another account's outbox; mismatched file metadata, actor, generation and digest are rejected; accepted deletion closes the session and exact cache even without network access. |

Independent review found and corrected a stale sign-out cache reset, the export
history cursor name, missing export provenance checks and deletion cleanup that
previously depended on a second network request. Existing support diagnostic
checks now distinguish retrying an unknown creation result from retrying file
metadata, preserving one idempotency key for the former and no extra creation
request for the latter.

Early owned-stack attempts `tholi-smoke-mvwwqckq-44591596`,
`tholi-smoke-mvwwwfjg-6aad51c2` and `tholi-smoke-mvwwywyo-c074388c` exposed a
fixture passing identity fields into strict security-audit input. The fixture
now projects the existing account/workspace scope; audit admission was not
weakened. `tholi-smoke-mvwx46ur-b2d20918` then exposed PostgreSQL operator
precedence in the manifest's nested JSON subtraction. Parenthesizing the JSON
operand corrected that strict production validator. All four failed stacks were
cleaned. Temporary value-free diagnostics were removed after the real SQL stage
passed on the next attempt.

The 92-check API feedback run `4fd40712-f705-4a42-9e54-fbd87cda32a8` passed 91
checks and exposed an old nine-route inventory expectation after the real storage
endpoint was added. The existing inventory assertion now covers ten routes and
the actual storage response. The 85-check website/API feedback run
`6865ef6c-15d9-4422-a255-2e4e488897e3` passed 84; its new SEO assertion incorrectly
treated private static pages as absent instead of present with noindex. The
assertion now checks indexing, retaining static deep-link support.

After the finance cleanup, `70b834b6-3004-495b-8596-b7b76735a297` passed the final
seven lifecycle, three finance and three SEO checks. Its five static-output checks
included one failure because the new fixture simulated Vite hooks out of order.
The corrected shared fixture preserves the production inventory guard, and
`9373add1-38c0-43fb-af31-68c3adb1dc07` passed all five static-output checks.

The first fresh CI-group attempt, `5aba0478-c92d-48bc-ad49-c0ec98fe07e9`, stopped
at TypeScript before building or running tests. The browser fixture's accumulated
records now use the canonical `SavedDataRecord[]` annotation, rather than an
implicitly inferred empty array. No passing unit or build result is attributed
to that failed attempt.

## Final verification

The owned local stack `tholi-smoke-mvwx6w3h-83d95e46`, run
`cef84255-4f66-43c8-aa0e-0151862c0e6d`, passed **99 actual PostgreSQL checks and
30 stack checks**. It covered bounded export continuation/discovery, strict
receipt metadata, legacy-format omissions, source-workspace revocation before
and after object writes, expired-lease quarantine, account deletion with physical
private-file cleanup, retained uncertain financial liabilities and stranded
organization ownership denial. Existing migration, tenant, plan, credit,
gateway/TLS, mail, telemetry, backup/restore and reset coverage remained intact.
All owned containers and volumes were removed.

The redacted report is
`output/qa/local-stack/tholi-smoke-mvwx6w3h-83d95e46/smoke.json`, SHA-256
`3e79da1924a2d2a6f61031102d6fc1b4de10457b8e3b4f11696dafac0314fe12`.
Temporary diagnostics were removed afterward without changing the permanent
checks. The exact-head hosted container gate must verify the final source too.

Before the real-storage adapter correction below, fresh `npm run test:ci -- --group unit`, run
`51dcd787-9cb8-40db-b6b7-3ed5cf1c5ba9`, passed type checking, version checks, every
production build and **1,113 unit checks across 81 files**. Its report is
`output/qa/account-60-final-unit/51dcd787-9cb8-40db-b6b7-3ed5cf1c5ba9/unit.json`,
SHA-256 `194b9ca3643fe670ba57cab4918022c7cc7015699cbceed002e5746a7e8b051f`.
The corresponding immutable build manifest has SHA-256
`7b982dee02b98322c2ca01f5826ecfa186a31c569b443a3e73d65ebe677af063`.
This local group is not the complete multi-group PR gate or release certification.

The actual lifecycle browser run `dfcfb173-309c-431b-acfa-639e89c235a2` exposed an
integration gap after export creation and reload discovery: jobs exhausted their
attempts while private files remained pending. The real S3 adapter still used
the diagnostic-only validator for PUT and read. Earlier injected `ObjectPort`
checks did not exercise that adapter path. Both adapter calls now reuse the
existing purpose-aware `validatePrivateFile` dispatcher, retaining object-key,
checksum, byte-size and strict-schema checks. Existing dead jobs were not replayed.

The existing adapter test owner passed **6 checks**, run
`87444619-af1d-4274-8495-2796a553208c`, including actual signed HTTP PUT/read for
saved-data exports, account parts and manifests, and rejection of wrong-purpose
or forged credential fields before PUT. Its initial sandbox startup failure
collected no tests and is retained separately. The final fresh build/unit,
real-storage browser and hosted container gates must cover this correction.

After the adapter correction and browser scenario split, fresh
`npm run test:ci -- --group unit`, run
`97aacb17-7470-4429-bdc7-9aff7f2fccbc`, passed type/version checks, all production
builds and **1,114 unit checks across 81 files**. Its unit report SHA-256 is
`9356bafdca8ccf3685b0aa1a3f8d7874d22f931c703aa625e6c3f57ee55043ba`;
the corresponding build manifest SHA-256 is
`25a97ffec0b750611e6d429cbfdcda4aeb1472d9cb73d010dc60fcede6e2ff7d`.
Both are retained under
`output/qa/account-60-final-unit/97aacb17-7470-4429-bdc7-9aff7f2fccbc/`.
The owned API and worker were then rebuilt from the corrected source. Both run
image `sha256:d2c6c679c599db86dd1da8d046e740d6606323ace7c860d4418a632f5fb3d5ed`;
the value-free proof is
`output/qa/tholi-smoke-account60-f7a9f706/runtime-image-proof.json`.

The Security availability correction distinguishes loading, ready and
failed discovery before presenting export/deletion controls. Its existing
lifecycle test owner passed **8 checks**, run
`0ce91766-2f30-4de3-af5a-f9389b5ec90b`, including the new delayed/error/confirmed
absence regression with no mutation calls. Final fresh type/version checks,
production builds and **1,115 unit checks across 81 files** passed in run
`81a6b21e-8fb6-4669-9389-9d0f8975d85a`. Its unit report SHA-256 is
`4983a0820ded265a5516255ebeb904295caffee3bc1c5face010a61c1b635120`;
its build manifest SHA-256 is
`9e9816308bf7028e4c2e72c8c7024c1f38e46a05fe911132c57416df084c3b05`.

The earlier browser candidate froze 85 changed implementation/test/configuration
files in `output/qa/account-60-frozen-source.json`, SHA-256
`e32c7acc1acf5e901dc114c03138f33ea9edfbc60f4813e865d1662d801245d6`.
Technical documentation is excluded from that map so these observed validation
results can be recorded without changing the tested implementation. Read-only
verification confirmed all 85 files and the changed-file set match the frozen
map, with no missing or mismatched files.

The complete exact-head hosted PR gate remains separate from these local groups;
its final result belongs to the pull request linked from #60 and is required
before merge. The configured identity website is built in an
isolated ignored QA directory; its validated output/adapter override is accepted
only by the explicit identity-web group. The default build manifest must verify
unchanged before and after that cohort. Private test contexts disable screenshots,
video and traces so credentials and mail action links stay outside artifacts.

The first real-browser cohort, `a31f6e3f-f665-4e99-8f21-74f84a8f8600`, failed
the original identity case's rapid account reentry at the gateway and the new
dashboard case's ambiguous paid-card locator in both browsers. The fresh repeat,
`dd2522a6-d6e9-4b7c-ac36-a45962544a54`, passed that reentry phase with zero observed
429 responses and bounded reads across intentional full-page entries. It then
exposed a later unacknowledged session-revocation request and exact-label fixture
assumptions for native controls with nested hints/options. Both failed cohorts
are preserved separately and their owned stacks were cleaned. Semantic form
selectors retain their exact option/value assertions. The session check now
awaits the independently identified mutation response before asserting its UI
notice and the other session's 401 response.

Two temporary Provider/Security dialog probes, `be576ab9-17dc-4360-8d79-57413d35fe5f`
and `7b619337-685e-4cb3-96d1-f8c160aa2665`, passed the local DOM revoke/notice and
retained-view accessibility checks. Those probes were removed. They are not
substitutes for the actual browser cohort.

A later paced Chromium diagnosis passed the complete original identity case
within its unchanged 300-second budget, including recovery, retained provider
configuration and sign-out everywhere. Temporary native observation saw OPTIONS
204, the exact revocation DELETE 200, the UI notice and the other session's GET 401. No native CORS failure was recorded. The production application, gateway
rate/burst policy and mutation outcomes were unchanged. Temporary network/DOM
diagnostics are removed after collecting this evidence; the final uninstrumented
two-browser cohort remains required.

Run `8442b97f-49ec-4ac7-b98d-47f2a02e3a96` passed all four Chromium cases,
including real storage delivery, account switching and accepted deletion. It was
stopped during Firefox after final review found a separate Saved Data recovery
gap: failed capability discovery was presented as confirmed unavailability and
Refresh could not retry discovery. These passing Chromium results remain
feedback for their original source state, not a completed final cohort.

The existing saved-data UI owner now distinguishes checking, available,
unavailable and failed discovery. Explicit Refresh retries only failed
discovery; filtering and paging add no metadata reads. Existing list/detail,
account-lifetime and mutation owners are unchanged. Five UI checks passed in
run `a656dee5-8b94-4cff-8fe6-baa8703e5fb5`, including preserved read/delete
access, delayed retry, confirmed absence and no unsolicited mutations.

The recovery candidate freezes the same 85 implementation/test/configuration
files in `output/qa/account-60-recovery-frozen-source.json`, SHA-256
`7a5380c7a8f216fe703c4d45389fc408348f54c4f26860b622b7351f2cf052ff`.
Only `SavedDataPage.tsx` and its existing UI test differ from the earlier map.

Fresh `npm run test:ci -- --group unit`, run
`12cfb7ad-9cad-456a-a651-1681ace29732`, passed type/version checks, every
production build and **1,116 unit checks across 81 files** after that recovery
correction. The report is retained under
`output/qa/account-60-final-unit/12cfb7ad-9cad-456a-a651-1681ace29732/`, with unit
report SHA-256
`113c74b57931036d4451af65e5d7efb6ba6608eac8c6dc3d7adec11b5c1abc99`
and build manifest SHA-256
`9a8b316f3df928ae2c02883dc1b0104665f8f1e4d3c242c43edf8f0cfa452413`.
The immutable manifest verified before starting the new complete browser cohort.

## Complete current-source browser cohort

Run `ec76dd65-0309-4529-acec-ef68bdc675e9` passed all **8 cases**, with cleanup
completed in every case, against real local identity, PostgreSQL and the corrected
S3-compatible adapter. It used Chromium `156.0.8078.4` and Firefox `157.0`.

| Scenario                                                           | Chromium | Firefox |
| ------------------------------------------------------------------ | -------- | ------- |
| Signup, recovery, retained identity and session revocation         | Passed   | Passed  |
| All four saved-data types, editing, filtering, export and deletion | Passed   | Passed  |
| Exact credits/storage, activity and five protected route reloads   | Passed   | Passed  |
| Full-account export, account switching and pending deletion        | Passed   | Passed  |

All eight reports share configured website digest
`c9d2fa257b14177b33ea6b0bf61dc32a93b720b87d6ba0d8a444a70f4bee262f`.
The default manifest remained unchanged and verified after the isolated build
and complete browser cohort. This uses the recovery source map recorded above;
no earlier passing case is substituted into this cohort.

Reports are retained under
`output/qa/tholi-smoke-account60-f7a9f706/identity-ec76dd65-0309-4529-acec-ef68bdc675e9/`.
The aggregate `outcomes.json` has SHA-256
`01a21a45546ac31d5f95b888b5c4bcc8db71097b2ab36ba874372e88d562b414`;
`verification.json` records the individual report hashes and observed coverage.
Independent read-only verification confirmed all eight passed/cleanup flags,
their common digest and UTC timestamps after the fresh unit/build run.

Both browsers exercised widths 320, 768, 1280 and 1600 in light and dark themes,
visible keyboard focus, 44-pixel targets and confirmation focus return. Data and
deletion flows also exercised 320 pixels with reduced motion. The capability
discovery-error retry is covered by the focused UI regression, not injected into
the native browser case. Changed-file formatting covered 95 supported files;
whitespace and new documentation link checks passed.

The owned project was removed with zero remaining containers, volumes or
networks. Its browser runners, port 5188 preview, three generated private
environment files and temporary driver were removed. The user's port 5174
preview and unrelated stacks were preserved. Final `verification.json` SHA-256
is `f62cc2e0985c1938ba8d25cf223a9e7401fa5f8f96a545beecf85b8a1471840d`;
it records the report hashes and value-free cleanup proof hashes.

## Operational limits

Inference and payment remain fake/local for this work. The deferred #43 live
comparison remains open and required before its downstream quality/release
gates. Native permission prompts, actual screen-reader speech, production
identity/billing, provider retention and hosted alert delivery are not certified
by these checks. Account exports describe a bounded collection over an interval;
deletion receipts describe accepted pending cleanup. The user requested a stop
after #60 is verified and merged; #61 and later implementation are outside this
change.
