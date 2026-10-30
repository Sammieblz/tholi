# Masked capture validation

Owner: [issue #38](https://github.com/Sammieblz/tholi/issues/38). The preceding
page-perception milestone was accepted through [PR #76](https://github.com/Sammieblz/tholi/pull/76).
Its [historical record](page-perception-validation.md) remains separate. This is
fresh implementation evidence, not release certification, publication or
deployment authorization. Extension/API 0.11.0 and website 0.1.1 remain unchanged.
No Gemini provider endpoint or new automatic image upload is enabled.

## Implementation and acceptance boundaries

| Boundary                  | Existing owner and resulting behavior                                                                                                                                                                                                                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Native scope              | [Background vision service](../../../apps/extension/src/background/vision-service.ts) checks the pinned tab, focused window, native document, actual zoom, host access, session/request/journey and page before capture, after capture and before use. Native events cancel stale work.                                                                                  |
| Complete privacy evidence | [Content visual guidance](../../../apps/extension/src/content/visual-guidance.ts) binds the capture ID to the retained page/scan pair. A complete traversal covers every field, editable surface, declared sensitive element and iframe rectangle; native open/closed-shadow access supplies geometry only. No field values or DOM text are read by that traversal.      |
| Mask before transform     | [Shared pixel processing](../../../packages/vision/processing.ts) preflights a local static PNG before bitmap allocation, draws it at native size, then paints opaque, outward-rounded masks before any crop, resize, grayscale or inversion. Both region-comparison sources follow the same path. Bitmaps and canvases are released on success, error and cancellation. |
| Single inference path     | The existing [OCR worker](../../../apps/extension/src/inference/ocr-worker.ts), engine and [bounded queue](../../../packages/vision/queue.ts) remain shared across targets. There is one active job and one replaceable pending job. Backend failure reuses the prepared masked OCR input locally; default OCR does not encode an unused navigation image.               |
| Final egress              | The existing backend client performs the asynchronous capture guard after capability, permission and protected-setting waits, immediately before sending. The internal optional color consumer receives only masked pixels, actual native scope and provenance, with a freshness guard; it supplies no fabricated full request generations.                              |
| Contracts and authority   | [Vision contracts](../../../packages/vision/contracts.ts) and [navigation contracts](../../architecture/navigation-contracts.md) validate bounded PNG output and source geometry. An image or matching region cannot authorize a website action, complete a journey or establish arrival. Raw captures are not sent, persisted or logged.                                |

The privacy traversal yields after eight milliseconds and allows two seconds per
walk, at most 256 document/shadow roots and 5,000 masks. Incomplete evidence is
refused. Overlay suppression has a one-second restoration watchdog, separate from
the 15-second proof lifetime. Restoring presentation does not renew its proof.
Rechecks traverse privacy geometry without rescanning or relabeling the original
observation. The capture throttle remains two seconds.

| Image stage                             | Bound                                                      |
| --------------------------------------- | ---------------------------------------------------------- |
| Original local PNG before bitmap decode | 16,000,000 pixels and 16 MiB                               |
| Prepared legacy OCR                     | 4,000,000 pixels and 4 MiB                                 |
| Optional navigation color output        | One viewport image or one crop, 4,000,000 pixels and 2 MiB |

Source bitmap dimensions and measured layout-relative scales are retained even
when the output excludes a scrollbar gutter or is downscaled. Crop bounds report
quantized native pixels and their corresponding CSS rectangle. Zoom multiplied
by DPR is not used as a substitute for measured scale. Nav1 inputs without
`source.captureCssBounds` keep their original visual-plane behavior. The optional
declared layout plane must exactly match the observed layout rectangle; older
strict receivers reject this field. Later transport must negotiate support.

## Native capture-plane evidence

The public RGB-fiducial experiment collected eight observations in run
`f3ce0c05-1791-4f11-9880-0f5d6a9232da`, from source
`fa90dd548f3b28cab1bdac630964b66a885b4d83`. Only numeric geometry and color counts
were retained; image data stayed in extension memory. Its report is
`output/qa/vision38-capture-plane/f3ce0c05-1791-4f11-9880-0f5d6a9232da/public-capture-extent.json`,
SHA-256 `c331ffb6b33403cadbba187e2c6d08e0ebd65dbbdb9d2c81520f98332116a1ce`.

| Browser              | Measured result                                                                                                                                                                                                                                                                                                                 | Evidence limit                                                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chrome 155.0.8059.40 | At zoom 1, layout width 1,280 CSS pixels and visual width 1,265 produce a 1,280-pixel bitmap. At zoom 1.25, layout width 1,024 and visual width 1,012 produce the same 1,280-pixel bitmap. The classic gutter is 15 native pixels in both cases, and measured scales are 1 and 1.25. Overlay cases also match the layout plane. | Original-manifest capture was denied. The successful experiment used an explicitly declared disposable `<all_urls>` variant; a genuine human capture-permission gesture remains pending. |
| Firefox 159          | Original-manifest capture after an actual automated toolbar activation measured 895 CSS/pixel width at zoom 1 and 716 CSS pixels to the same 895-pixel bitmap at zoom 1.25. Measured scale is 1.25 in the latter case.                                                                                                          | All observed gutters were zero despite requesting stable scrollbars. This establishes overlay behavior only, not Firefox classic-gutter behavior.                                        |

These observations justify an explicit native layout-plane profile for the
measured cases; they do not certify every browser, display scaling or scrollbar
configuration. Firefox positive-gutter/layout-versus-visual differences currently
fail closed. Pinch/pan, unavailable native shadow privacy access and sources over
the decode budget are unsupported.

A separate numeric-only diagnostic, run `fa607d7b-5574-4d29-b774-b977a5d4c3cb`,
measured Chrome at zoom 0.8: layout 955 by 536, visual 936.25 by 536.25, and the
actual native PNG 764 by 429 pixels. DPR was `0.800000011920929`; bitmap dimensions
were read from the real capture, not inferred from DPR. This exposed the former
exact integer-layout containment check, which omitted perception at a valid
fractional visual edge. Its report remains distinct at
`output/qa/vision38-capture-plane/fa607d7b-5574-4d29-b774-b977a5d4c3cb/browser-performance.json`,
SHA-256 `32244fb5701f4084cdef76c1a9b7f3fc2d992ed7e275e8507bca2bb9899a8fb9`.
It predates the precision correction and is not a passing masked-pixel cohort.

The correction preserves both raw metrics, permits at most 0.5 CSS pixels of
visual overhang against integer layout precision, and masks the full observed
layout/visual union. Source aspect checks use bounded CSS/native rounding
intervals without DPR inference; the original source plane and final one-pixel
geometry bound remain unchanged. Unit regressions cover the measured fractional
bottom band, a synthetic integer-roundup counterpart, true aspect mismatch and
unrepresentable crops. These are implementation checks, not new native evidence.
See the [coordinate policy and primary CSSOM references](../../architecture/navigation-contracts.md#images-and-coordinate-provenance).

## Precision-corrected native pixels and egress

The fresh build passed with manifest SHA-256
`4a7dd41d2deca8710fefca4550b2e6a2d32634f7de0d88619cc0a5fc5531faa8`,
Chromium digest `37ad54bae5920918b12f3297258f440b911b8b056fe47c974b8c877a67157561`
and Firefox digest `2ef17caf2069fb9dc9bacc8aff8ffedec207be93310feac55731347e768c4a4c`.
It was built from the modified working tree based on
`fa90dd548f3b28cab1bdac630964b66a885b4d83`, not a clean new commit. The recorded
digests identify the tested code bytes. Before/after manifests were verified;
Chrome still used the declared disposable capture pregrant, while Firefox used
the original manifest with automated native toolbar activation.

Pixel run `37b18517-c49d-436b-a116-c2b27b966cae` passed both target cases on Chrome
155.0.8059.40 and Firefox 159.0. Six observations cover zooms 0.8, 1.25 and 2, with
19 independently declared private fixture rectangles in each. Every private
output pixel was checked: full color covered 80,676 to 233,212 pixels per
observation, crops 4,720 to 12,528, and OCR 80,914 to 233,212. All three modes had
zero private-pixel failures. Public color controls remained visible in the full
color output; Tholi presentation was absent. Native style restoration, stale
lease refusal and animation refusal passed. Fresh private-region comparison
passed at zoom 1.25 on each target; it was not requested at the other zooms.

Chrome's zoom-0.8 full-color final row included 29 bottom-field samples and 13
fractional-band samples, all opaque. At zoom 1.25 the corresponding counts were
46 and 21, also all opaque. The fixture's actual visual extent supplies the
independent bottom-band mapping; worker mask rectangles are not its oracle.
The report is
`output/qa/vision38-private-pixels/37b18517-c49d-436b-a116-c2b27b966cae/browser-performance.json`,
SHA-256 `0cf306b30ab90ecb9ae35ddae7eaa2896aa86acab990507b9c252a8682831066`.

The separate actual Chrome egress run
`eaf51e22-94f5-48e7-8246-bc9483d56372` used the same verified build. It observed
two real prepared-input requests. Health was held after the first masked
preparation; changing private geometry before releasing health resulted in zero
OCR POSTs. An unchanged positive retry sent exactly one valid masked PNG with
the new capture ID, and no unrelated POSTs occurred. The loopback receiver kept
the body in memory and returned 503 deliberately; it supplied no successful OCR
prediction or outcome authority. No image or body artifacts were saved. The
report is
`output/qa/vision38-egress/eaf51e22-94f5-48e7-8246-bc9483d56372/browser-performance.json`,
SHA-256 `e46e2b19326bcbb5e1edf02d80f41d1fe503c5a4f74fbb0624c524dd6799c070`.

The earlier manifest `86db70b25af7828402979626781f805a7d862c9bf333eb9e70539913334382f3`
remains separate. Run `0909fd07-8b56-4310-88cc-c0337aaf49d3` failed Chrome and
passed Firefox with 51 private sample pixels per zoom. That sample check was not
exhaustive and does not certify the later precision-corrected artifacts. Other
failed capture/QA attempts remain preserved. The compact
[content-free evidence index](evidence/masked-capture-2026-10-30.json) records
their individual hashes and counts alongside the current measurements; it
exports no private geometry, field text, images or request bodies.

## Assigned-slot correction and final focused native cohort

A later regression found that a private closed-shadow wrapper could receive
light-DOM text through a slot without retaining its private ancestry in the mask
walk. Run `7c983321-4821-47d5-ac29-c2aa88e6e74b` confirmed an empty mask list:
one selected test failed and 13 were skipped, not 14 executed failures. The
existing privacy owner now follows assigned nodes individually, carries private
paint ancestry, avoids including unrelated public siblings and invalidates on
slot changes. Semantic discovery remains unchanged. The focused correction
passed 14 tests in run `815ecace-7033-41c6-806e-2d46caa1a0e4`; combined types and
115 tests across eight files passed with run
`263aebc6-6c7b-440b-ba8b-5b266c7a4784`.

The new build has manifest
`d5a8f82fa541055498f0d3307b361dd02882bc6707a527f51344a26dcdb310d0`,
Chromium digest `d684b89d75f745a3d5cec1ac0a985e879976d0b752e653442f814fb09d3d8ab1`
and Firefox digest `bed4897e1ef84dd4ddea2c322c8c251c11ffc28e4c8beaf48e2bf5e2ab20a5ec`.
These again identify code built from the modified working tree, not a new clean
commit. The earlier 4a7d build and its evidence remain distinct.

The first four-case native run, `63f8af01-006d-4ea4-bc11-abfb1c861637`, passed
egress and paired performance but failed both native public-color expectations.
A numeric-only diagnostic, `ee6727c5-f42d-4100-9e0f-d4bcdb29571b`, established that
private text overflow actually painted over the supposed public control. The
fixture moved that control outside the private paint and added an independent
overflow rectangle. No production code changed for this fixture correction.
Both reports and their hashes remain separate in the evidence index.

Final run `0d3606b5-773d-4266-b25b-13289de80cf8` passed all four cases on the same
d5a8 build, verified before and after. Six target/zoom observations now each
check 21 independent private rectangles. Full color and OCR include positive
slot-text and painted-overflow pixel counts, with zero private-pixel failures;
the separate crop checks also have zero failures, but their selected rectangle
does not include the slot. Public slotted color remains visible outside private
paint. Chrome's final-row/fractional-band checks remain 29/13 at zoom 0.8 and
46/21 at zoom 1.25, all opaque. The actual egress negative/positive control again
observed zero stale OCR POSTs and exactly one valid fresh POST.

| Target      | Warm planning p95 | Warm OCR p95 |  Pause / Stop | Busy-page frame p95 |
| ----------- | ----------------: | -----------: | ------------: | ------------------: |
| Chrome 155  |          129.4 ms |       722 ms | 14.5 / 7.2 ms |            229.8 ms |
| Firefox 159 |            171 ms |       682 ms |    10 / 14 ms |           170.18 ms |

The existing paired checks passed on the 50,000-node fixture; these frame timings
do not establish 60 fps. The earlier paired run `00596ba2-9d81-46c0-b6ce-0cdf8491cf34`
remains before-slot evidence. Final report:
`output/qa/vision38-final-browser/0d3606b5-773d-4266-b25b-13289de80cf8/browser-performance.json`,
SHA-256 `f8c2d604f8d2e1e9e3fd343be7b24219e0f4c8d3e7dabd2edb4b540bfeea72c8`.
This focused project pass is not complete CI or release certification.

## Checks and remaining gates

| Evidence                                                    | Recorded result                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Whole-project types before the precision correction         | Passed after the native API and DOM fixture typing corrections. This is implementation feedback, not evidence for later source.                                                                                                                                                                      |
| Initial combined focused cohort                             | 84 of 85 passed in run `ef6eb674-78bb-484c-be4b-7d82a619a2a9`. The jsdom backdrop fixture failed and remains a separate failed attempt.                                                                                                                                                              |
| Corrected content-focused cohort                            | 19 of 19 passed in run `973247ce-ea0a-4f86-8c90-29566b9ef8e3` after correcting the fixture. This narrow rerun does not replace the failed combined cohort.                                                                                                                                           |
| Combined cohort before the precision correction             | 108 of 108 passed across eight files in run `3e337f39-affa-4d8c-b277-f9169f9a27ea`, including post-await ownership, settings/cancellation, backend egress, complete privacy traversal, native masking order, prepared fallback and image/source contract regressions. This is working-tree feedback. |
| Precision-corrected types and focused cohort                | Whole-project types passed; 114 of 114 focused tests passed across eight files in run `c72f9f8a-92f4-4910-bb4d-ad666d91bbe8`.                                                                                                                                                                        |
| Fresh production build and paired native pixels             | Build passed with the manifest and target digests above. Both native target cases passed in run `37b18517-c49d-436b-a116-c2b27b966cae`.                                                                                                                                                              |
| Native backend egress                                       | The negative stale-proof case and positive masked-input control passed in run `eaf51e22-94f5-48e7-8246-bc9483d56372`.                                                                                                                                                                                |
| Assigned-slot correction and final build                    | Types, 115 focused tests and the fresh d5a8 production build passed. Earlier cohorts remain attached to their original source/build.                                                                                                                                                                 |
| Final paired native pixels, egress and performance          | All four cases passed in run `0d3606b5-773d-4266-b25b-13289de80cf8` with the recorded d5a8 target digests.                                                                                                                                                                                           |
| Complete local CI, exact final-head hosted checks and merge | Pending. No final acceptance or certified archive is claimed by this record.                                                                                                                                                                                                                         |

Each focused run retains its `unit.json` and `timing-unit-all.json` under
`output/qa/vision-38-focused/<run-id>/`. These source-level runs do not establish
that their pre-existing build artifacts contain this implementation; fresh build
and native artifact validation remain separate gates.

Earlier failed capture experiments and fixture failures remain distinct from the
completed eight-observation matrix. A corrected harness or narrower rerun does
not relabel the previous attempt. Final validation must identify its exact source,
build digests, target, browser/version and run; Chromium evidence cannot certify
Firefox artifacts.

The implementation refuses private pixels with active page animation, filtered
or shadowed private overflow, or backdrop paint. Generated paint and arbitrary
private canvas contents cannot be inferred from DOM masks. Pre/post checks do not
make DOM traversal and native screenshot capture atomic. Native masked-pixel
regressions can verify declared fixture behavior but cannot establish an
arbitrary-pixel guarantee, signed-in-site coverage, human permission recovery or
screen-reader behavior. Those remain separate checks. Full certification is
required before packaging, and any release or deployment requires its own
authorization.
