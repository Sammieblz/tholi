# Chromium and Firefox implementation record

Date: October 17, 2026. Working-tree implementation evidence, not a signed release or store listing.

## Scope

One local engine targets Chromium 140+ and Firefox 153+. Chrome, Edge, Brave and Firefox have separate Windows execution checks. Other Chromium browsers are capability-compatible rather than explicitly verified. Safari and WebKit are outside this pass.

Both unpacked builds are generated locally. Firefox is an unsigned temporary-install developer preview. No released archive is overwritten or promoted using partial evidence.

## Evidence collected during implementation

- Final-build types, 289 unit contracts, frozen model/OCR suites, 47 Chromium core cases, 21 integration cases and 42 extension/website UI cases passed. Website routes reflow at 320, 375, 768 and 1440 pixels in both themes in Chromium and Firefox.
- Chrome 155.0.8059.41, Edge 155.0.4283.45 and official portable Brave 1.97.59 (Chromium 155.0.8059.85) loaded the final Chromium bytes, independently verified a website interaction and passed native sidebar/widget continuity checks.
- Installed Microsoft Store Firefox 158 passed native identities, inference, outcomes, masked capture, minimized arrival, native sidebar handoff, actual event-page suspension/recovery, private settings/session isolation and authorized/ungranted frame checks on the final Firefox bytes.
- Paired final-build performance checks passed; measurements are below. Firefox completed all 90 acceptance samples across both viewports with zero false arrivals, automated actions or secret leaks. Chromium acceptance and aggregate certification remain blocked as detailed below.
- Resource-exhausted and interrupted attempts remain incomplete evidence. Windows reached roughly 16 MB free RAM with about 4.7 GiB in memory compression. No accuracy or product-response budget was relaxed.

## Browser differences found

Firefox gives web-embedded extension frames a restricted API subset. The background-owned snapshot port remains usable; tab events and sidebar opening cannot be called there. Failed widget Dock retains the widget and guides the user to the toolbar for native handoff. This follows [Mozilla's tracked limitation](https://bugzilla.mozilla.org/show_bug.cgi?id=1443253), without broadening privileges.

Gecko BiDi rejects privileged extension contexts for network interception. Deterministic website traffic is intercepted; packaged extension assets, CSP, settings isolation and transport receive separate checks. Selenium/geckodriver executes the actual Firefox extension. Playwright Firefox projects test the website.

## UI guidance applied

Project-local [UI UX Pro Max guidance](../../../.codex/skills/ui-ux-pro-max/SKILL.md) on labeled forms, accessible names and visible state is applied to Download: persistent label, native keyboard selection, shareable browser query parameter and explicit preview/minimum-version text. Both themes and responsive widths use existing website tokens. Genuine Chrome media is identified without recoloring it.

## Final validation

Validation identity: `browser-support-20261017-final-4`. All owners except Chromium acceptance passed on the frozen bytes below. Firefox acceptance passed all twelve cases and 90 samples in 15.5 minutes. Chromium has no complete passing final report; the aggregate gate therefore rejects certification. Earlier interrupted attempts and partial reports cannot certify either target.

Native permission dialogs, screen-reader speech, signed-in workflows and hosted CI runtime remain pending. Automated native installation/surface execution is separate from manual extension-manager and accessibility review. No store publication or deployment occurred.

Both target builds contain byte-identical `inference.js` and `ocr-worker.js`. Final digests:

- Chromium: `158656eb14fc86e6872ffa82ea1604b71dfdbb1196074fdb5d1a13aabc9def89`.
- Firefox: `f875a94db65e0335d425dd189a5166812fb151b3762384e228a6ce8914e88799`.

The actual Firefox packaging command rejected partial/stale evidence on these final bytes. No archive was created or overwritten. The local website preview serves the built website on port 5174; tests use 5188.

## Paired final-build measurements

Windows, AMD Ryzen 7 5700U, 16 logical CPUs, 7.4 GiB RAM, Node 24.19.0. Fresh disposable profiles ran serially on the same host. Both used bundled MiniLM Q8, one WASM thread, the same goals and frozen 1920 × 1080 OCR image. Twenty warm planning and ten warm OCR samples per engine. These measurements belong to the final validation identity and target digests above; they do not independently certify a release.

| Browser              | Cold planning | Warm planning p95 | Cold OCR | Warm OCR p95 |  Stop |
| -------------------- | ------------: | ----------------: | -------: | -----------: | ----: |
| Chrome 155.0.8059.41 |       1344 ms |            126 ms |   880 ms |       640 ms | 54 ms |
| Firefox 158.0        |       1043 ms |            201 ms |   872 ms |       562 ms | 25 ms |

Both pass the unchanged 750 ms planning, 2000 ms OCR and 1000 ms Stop budgets. No relative browser tolerance or lower accuracy requirement was introduced.

The 50,000-node/100-mutations-per-50-ms workload retained one highlight. Frame p95 was **266.6 ms in Chrome** and **150.0 ms in Firefox**, which is visibly slow; this is not smoothness evidence. The existing motion workload has no numeric frame-rate certification threshold, and no threshold was relaxed.

Whole-browser process-tree working sets were sampled before inference, after planning and after OCR: Chrome approximately 762/1034/889 MiB; Firefox 720/1129/976 MiB. Private committed bytes and process counts are also retained in `output/qa/browser-performance.json`. These are three snapshots, not peak-only extension memory, and shared browser pages may be counted more than once.

## Coverage ownership

No existing acceptance goal, frozen corpus, safety assertion or media asset changed. Pure model/engine tests run once. Chromium and Firefox share the positive and negative acceptance contracts, fixture HTML and outcome assertions; browser adapters supply actual interactions. New retained coverage owns distinct browser boundaries, native branded surfaces, paired performance and Firefox website execution. No duplicate navigation engine or background session owner was introduced.

## Baseline investigation

Early Chromium runs passed their behavior assertions but timed out during browser disposal. An interrupted trace was truncated and is not evidence. Final cleanup has a separate thirty-second bound and records actual time, preserving the original body deadline. Core traces retain actions and DOM snapshots without continuous screencast frames. The final core run passed all 47 cases. Inference, Stop, verification and assertion deadlines are unchanged.

Timed-out Firefox runs stranded disposable browsers. Native test ownership now guarantees bounded teardown and rechecks executable, process ID and exact temporary profile before forced cleanup. Forced or failed teardown remains a failure. No user profile is closed. Public-site adapter corrections wait for MediaWiki's late controls and use actual native checkbox targets; the frozen goal/outcome requirements are unchanged.

The activation regression now explicitly proves that stale sidebar context requests no grant and starts no scan before retrying the rejected action on refreshed context. Complete integration revalidation passed all 21 cases. Earlier failures and interruptions are retained in local logs and cannot authorize packaging.

Chromium acceptance intermittently failed its retained site-memory persistence assertion. Its captured observation/task validated against the existing schemas. A four-case diagnostic batch reproduced the failure in desktop Ada Lovelace; the other three cases passed. Native IndexedDB events recorded seven transaction aborts at 5008–5020 ms, with pending requests reporting `AbortError`. This identifies the existing five-second transaction deadline as the failure mechanism, rather than a schema error. The underlying cause is unresolved. Severe host memory pressure was present, but that correlation does not prove causation. Storage implementation and deadlines were not changed to obtain a pass. Temporary instrumentation and snapshot files were removed.

Earlier Chromium attempts also recorded Search focus-oracle failures and resource-related timeouts. The setup now settles its own scrolling before measuring focus; subsequent observed failures were persistence/timeouts, but no complete clean Chromium run establishes resolution. No false-success allowance was introduced. A complete Chromium owner can be run with `node scripts/test.mjs full --group acceptance-chromium` in an existing coordinated validation environment with verified immutable builds, followed by `node scripts/verify-full.mjs`. For fresh certification on an adequately resourced machine, run `npm run test:full`; do not combine its reports with this validation identity. The target-specific CI jobs preserve complete independent Firefox evidence while a Chromium failure keeps release gates closed.
