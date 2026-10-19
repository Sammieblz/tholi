# Navigation responsiveness and memory

October 19, 2026. Baseline: `eed27e5`; source **0.11.0, unreleased**.
This follow-up addresses buffering, blocked cancellation and unnecessary work.
It does not establish zero overhead on every website or processor.

## Changes and ownership

- Discovery excludes Tholi-owned shadow roots in both scanning paths. Widget
  mounting/removal cannot trigger another website scan. Unrelated ticking text
  is ignored; controls, modal changes, receipts and referenced accessibility
  labels/descriptions still update. Reference bookkeeping is bounded by the
  control index and cleared when observation stops.
- The existing plan lifecycle allows one automatic plan in flight, coalesces
  subsequent requests and bounds stale-scan recovery across changing
  fingerprints. Repeated invalidation pauses checking with the destination
  retained. Fired recovery timers clear their handles before requesting work.
- Validated **Pause/Stop** go directly to the same session owner, bypassing routine
  queued work. Pending results, inference and frame observation are invalidated
  without waiting for a busy page's acknowledgment. Native document/session
  checks and generation fences prevent old work from restarting the task.
- Pause and Stop stay enabled during planning and on another active tab; Resume
  keeps its availability checks. Canceled UI submissions are discarded and
  redundant suggestions are suppressed during planning or for the submitted goal.
- Embedding output tensors are disposed. Observation caches clear on teardown.
  Idle OCR workers release after **10 seconds**, planning workers after **30
  seconds**, and the idle inference host after 30 seconds rather than two minutes.
  Serialized startup/disposal prevents canceled startup from creating another
  worker after native context lookup finishes.
- Hot vectors and content hashes are bounded at **1,024 entries** each. The
  provisional 512-entry vector cache was rejected: it re-embedded all 601 active
  page/query texts on a second pass. The retained budget fits the 600-control
  projection plus its query without persisting private text. The existing cache
  test guards this behavior.
- Fresh observations publish before asynchronous replanning. Verified frame
  journeys become completed. Hiding controls behind a new parent dialog no longer
  depends on a second, redundant scan.

Weights, quantization, single-thread settings, frozen inputs, quality thresholds,
host grants and consequential-action boundaries are unchanged. Learned knowledge
and storage identifiers are preserved. No new dependency, cloud service or
background polling loop was introduced.

Applied local [UI UX Pro Max guidance](../../../.codex/skills/ui-ux-pro-max/SKILL.md)
on loading feedback and user control. Existing labels, keyboard access, focus
treatment and button dimensions remain intact. Existing guidance/lifecycle owners
were extended rather than copied into a parallel test suite.

## Verification scope

Evidence cohorts remain separate; they cannot be merged into a release certificate.

| Cohort                            | Coverage                                                                                             | Result                  |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------- |
| `performance-2026-10-19-v3`       | All PR groups: unit 299, core 47, specialized integration 20, Firefox 2, extension/website UI 32     | **400 passed**          |
| v3                                | Frozen NLP/multi-app/OCR; paired browser experiment                                                  | 32 + 1 passed           |
| `performance-2026-10-19-v4-cache` | Final cache adjustment: types, all application builds, unit, model/OCR and paired browser experiment | **299 + 32 + 1 passed** |

The final change after the PR cohort affects the NLP inference bundle and source
maps. Chromium's background, content and interface JavaScript remain byte
identical to v3. Final model checks include API parity, cancellation and the
601-text private-cache regression. Browser coverage includes blocked durable
writes, permissions, native identities, frame occlusion, portalled menus, restart,
pause, stop, keyboard focus and widget continuity.

The controlled Prime journey passed through login, delayed 2FA, documents,
membership menus and cancellation review, using an independent website receipt
as its completion oracle. **The user's signed-in Amazon account is not verified.**

Unchanged NLP gates passed with precision/coverage 1.0, zero false completions and
zero boundary bypasses. Multi-app gates passed; GitHub retains the previously
recorded 0.9643 held-out precision/coverage and one target mismatch. Frozen vision
gates passed. Inputs and thresholds were not recalibrated.

Earlier portalled-menu/frame failures were corrected before the v3 pass; temporary
console probes were removed. An original-build stress run was stopped with about
18 MiB free host memory. It remains **incomplete**, not passing evidence or a
reliable before/after baseline.

## Final measurements

Windows, AMD Ryzen 7 5700U, 16 logical CPUs, 7.4 GiB RAM, Node 24.19.0. Native
Chrome **155.0.8059.41** and Firefox **158.0** ran serially with MiniLM q8 and one
WASM thread.

| Browser | Cold planning | Warm planning p95 (20) | Cold OCR | Warm OCR p95 (10) | Pause | Stop  |
| ------- | ------------- | ---------------------- | -------- | ----------------- | ----- | ----- |
| Chrome  | 1,750 ms      | 129 ms                 | 1,066 ms | 660 ms            | 13 ms | 6 ms  |
| Firefox | 1,500 ms      | 166 ms                 | 982 ms   | 649 ms            | 15 ms | 20 ms |

Pause followed eight queued routine page reads. Both browsers met unchanged
750 ms warm-planning, 2,000 ms warm-OCR and 1,000 ms Stop budgets. Pause now has
the same 1,000 ms response budget. These are local measurements, not guarantees
for all hardware or authenticated websites.

The 50,000-node mutation scene retained the same highlight. Frame p95 was 250 ms
in Chrome and 233 ms in Firefox; repeating the scene with Tholi stopped measured
267 ms and 217 ms. **The extreme scene still has long frames.** These ordered
samples do not establish a causal improvement or smooth rendering. Hosted timing
and weaker-CPU measurements remain pending.

Whole-browser working-set/private-commit samples are in
`output/qa/browser-performance.json`. They include the browser, page, UI, model
and OCR; they are not isolated extension or peak-memory measurements. Worker
disposal is verified, but browser heap reservations can outlive workers. No fixed
RAM saving is claimed from Task Manager totals.

Final build tree digests, not ZIP checksums:

- Chromium: `e8a49f8ce6b92e52261f0b92874d906f004a150e4a3308e2331577954a01c3ed`.
- Firefox: `c8305022d0d7dfb35fd2c944a143d7a175481f567dbddf0ef2347058d0a8924a`.

Current targeted evidence is under `output/qa`, `output/nlp`, `output/multi-app`
and `output/vision`; the PR cohort snapshot is retained locally under
`output/qa/performance-v3-evidence`. Generated outputs are not published releases.
Full final-byte certification, signed-in checks and remaining native/manual checks
are still required by [the release checklist](validation.md). No archive, signing,
publishing or deployment was performed.

## Use the rebuilt extension

Reload Tholi from `dist/extension` in Chromium, or reload the temporary Firefox
installation from `dist/extension-firefox/manifest.json`, then refresh the website
tab. Existing tabs need the refreshed content runtime. See
[installation](../../guides/getting-started.md) and
[interface behavior](../../guides/using-tholi.md).
