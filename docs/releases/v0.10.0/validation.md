# Tholi 0.10.0 validation

Evaluated on 14 October 2026 on Windows, AMD Ryzen 7 5700U, approximately 7.4 GiB RAM, and Node 24.19.0. This is a release candidate with native Chrome and signed-in checks pending.

## Artifacts

- Unpacked extension: `dist/extension`, 61,723,341 bytes (58.9 MiB), below the 100 MiB limit.
- Offline extension ZIP: `output/releases/internet-navigator-0.10.0.zip`.
- ZIP SHA-256: `33eefaef6927d533d8c6a7322dbc0b7f3ccb82db7d6a93e52d4a9d18714a829e`.
- Optional backend: `output/releases/internet-navigator-api-0.10.0.tgz`.
- Website: `dist/web`; run `npm run dev:web` for the local preview on port 5174.

The gated packager checked every ZIP member against the evaluated build. The generated website manifest now identifies 0.10.0, and post-packaging website tests verified its download checksum. Original older archives remain in `output/releases`; only the latest eligible ZIP is mirrored into the website. No site has been published.

## Automated checks

| Check                                                                       | Result                     |
| --------------------------------------------------------------------------- | -------------------------- |
| Unit regressions and UI presentation/attention invariants                   | 178 passed                 |
| Tholi sidebar, Conversation, widget, responsive website and mock onboarding | 9 passed                   |
| Post-packaging website and actual ZIP checksum                              | 4 passed                   |
| Desktop and narrow browser regressions                                      | 90 passed                  |
| Real MiniLM, frozen 200-case corpus, API, migration                         | 11 tests passed            |
| Multi-app models, frozen 360-case corpus and API                            | 17 tests passed            |
| Real OCR, API, performance and held-out route corpus                        | 4 tests passed             |
| Offline NLP browser, clarification, queues and reported Wikipedia failures  | 12 passed                  |
| Multi-app browser discovery, permissions, frames and performance            | 7 passed                   |
| OCR, return routes and parked journey continuity                            | 3 passed                   |
| Prime fixture and frozen UI-image OCR comparison                            | 2 passed                   |
| Live Wikipedia regression                                                   | 16 passed                  |
| Frozen accuracy matrix                                                      | 14 tests, 116 cases passed |

The accuracy matrix recorded zero false success, automated website actions, and secret leaks. Frozen NLP/Wikipedia inputs and acceptance thresholds were preserved. UI selectors changed to reflect the new interface; navigation and outcome assertions remain in place. The API source JSON import now declares its JSON type for Node 24 source loading.

Screenshots cover 300, 380 and 620-pixel sidebars, 200% browser zoom, standard/compact/minimum widgets, and 375, 768 and 1440-pixel websites. They are stored locally under `output/qa/tholi-ui`. Fixtures verify storage isolation, fresh widget registration after reload/Expand, rejected cloned frames, capture exclusion, and real pointer dragging/resizing. Strict TypeScript also passes.

## Measurements and limits

- Warm NLP planning p95: 5.4 ms on the evaluated corpus.
- The 50,000-node/5,000-control discovery benchmark: initial 183.6 ms, relevant refresh p95 342.6 ms, warm planning p95 123.4 ms.
- Warm 1920 × 1080 OCR p95: 494.4 ms.
- The UI mutation storm retained one highlight root; JavaScript frame-gap p95 was 266.8 ms. The deliberately dense inline-text fixture still causes rendering stalls. This result does not establish smooth animation on every busy dashboard.

Default processing remains local MiniLM and Tesseract, with the experimental LLM disabled. Paddle remains excluded from normal builds and has not been promoted by this pass. UI changes do not establish universal dashboard routing accuracy.

## Still pending

Native Chrome sidebar activation/closure, real permission dialogs and capture recovery, actual screen-reader speech, keyboard widget handles, and signed-in Amazon, Cloudflare and GitHub workflows require user-assisted checks. Authenticated fixture responses are not live-site passes. Use [the Chrome checklist](../../guides/getting-started.md).
