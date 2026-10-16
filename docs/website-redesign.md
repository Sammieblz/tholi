# Tholi website implementation and verification record

Date: October 16, 2026. Source version: **0.10.1**. Eligible packaged download: **0.10.0** until the existing packager accepts newer matching build bytes.

This pass changes the local product website and public-page capture tooling. It does not change extension routing, activate cloud inference, create accounts, deploy a website or replace a release archive. Website polish cannot establish accuracy on signed-in dashboards.

## Audit and product direction

The website explains one sequence: describe a destination, follow a fresh grounded instruction and reach a verified result. Jade guides, amber marks the destination, and surrounding controls stay quiet. Manrope, Outfit, the supplied wordmark, Iconoir and Base UI remain in use.

| Before                                                | After                                                                                         | Why                                                                                       |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Static first screenshot and repeated section geometry | Real extension footage below the introduction, distinct product/explanation/practice chapters | Product evidence leads the story and sections have recognizable boundaries.               |
| Decorative arrows on routine marketing links          | Direct action labels, with icons reserved for functional media/navigation controls            | Labels carry the action without unnecessary accessories.                                  |
| System-only appearance                                | Dark-first startup and an explicit Light/Dark control                                         | Both surfaces are deliberate, including the framing of unaltered captured UI.             |
| A boxed About marker with rings                       | Transparent shared Wayfinder stage with an automatic labeled state loop                       | Personality explains actual product states rather than suggesting invented task progress. |
| Identical reveals across many sections                | Selected introduction, media, explanation and closing choreography                            | Motion has a specific explanatory role and respects normal scrolling.                     |
| Sparse footer and repository-only information         | Grouped footer, searchable current documentation and honest launch-document drafts            | Installation, support and privacy information are reachable without a demo account.       |
| No website storage controls                           | Necessary choice cookie plus opt-in appearance cookie, with real withdrawal                   | The consent interface governs storage rather than simulating a choice.                    |

## Reference review

The research compared desktop and narrow layouts using disposable browser sessions. Screenshots are under ignored `output/qa/reference-design/`. These are design references, not product partners or templates to copy.

| Source                                                  | Observed lesson                                                                    | Applied to Tholi                                                                                                     |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [Loom](https://www.loom.com/)                           | Prominent genuine product video, explanatory reading surfaces and a grouped footer | Actual extension recording before the detailed explanations and a useful multicolumn footer.                         |
| [Weavy](https://www.weavy.com/)                         | Strong changes in composition, scale and spacing separate chapters                 | Different media, three-step, practice and privacy compositions with branded surfaces. Its gradients were not copied. |
| [Notion](https://www.notion.com/)                       | Concise feature statements paired with real product evidence                       | Short explanations alongside the actual shared practice, recording and genuine screenshots.                          |
| [The separate tholi.app product](https://tholi.app/en/) | Coordinated scenes explain a product more clearly than disconnected decorations    | One labeled Wayfinder sequence. No copied brand, contact, product claims or mandatory scroll takeover.               |

The referenced tholi.app is unrelated to this repository's Tholi. Its domain is not this product's configured public domain.

## Project-local skills applied

Upstream skill files remain intact under `.codex/skills`. Sources, pinned revisions, licenses and file hashes are recorded in [the skill manifest](../.codex/skills-manifest.json). The approved stack and brand override generic suggestions to add Tailwind, a motion framework or an unrelated palette.

| Local guidance                                                                                                                    | Specific application                                                                                                                      | Validation owner                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [Apple Design](../.codex/skills/apple-design/SKILL.md), `layout.md` under Visual hierarchy and Adaptability                       | Group related content, keep long-form measure readable, collapse documentation to available space and preserve functions at narrow widths | Website route/layout matrix and screenshot review.                                                    |
| Apple `typography.md` under Ensuring legibility and Conveying hierarchy; `color.md` under Best practices                          | Existing typefaces carry a clear scale; semantic tokens provide separate light/dark text and surfaces                                     | Both-theme screenshots and contrast checks.                                                           |
| [UI UX Pro Max](../.codex/skills/ui-ux-pro-max/SKILL.md), local UX search for documentation navigation/search                     | Immediate local results, useful no-results suggestion and navigation that leaves the article unobscured                                   | Documentation unit tests and browser navigation checks.                                               |
| [Baseline UI](../.codex/skills/baseline-ui/SKILL.md) and [Fixing Accessibility](../.codex/skills/fixing-accessibility/SKILL.md)   | Existing Base UI dialogs, native labeled controls, semantic navigation/tables, real error associations, hash focus and focus return       | Focused tests plus integrated keyboard/layout checks.                                                 |
| [Animate](../.codex/skills/animate/SKILL.md), purpose gate, existing tokens and cheapest tool                                     | Explanation-focused marketing motion, CSS/WAAPI, optional motion, native scroll timeline with a single-frame fallback                     | Reduced-motion, pause/offscreen/cleanup and timing checks.                                            |
| [Emil Design Engineering](../.codex/skills/emil-design-eng/SKILL.md), review table and interaction philosophy                     | Before/After audit, genuine product behavior, precise action labels and restrained motion                                                 | Real recording provenance and interactive practice regressions.                                       |
| [Animation Performance](../.codex/skills/animation-performance/SKILL.md), transform/opacity defaults and no per-frame React state | Direct transform/opacity updates for the decorative point, no animated blur/shadow surfaces and offscreen suspension                      | Browser timing attachments on documented hardware. Source inspection alone is not a smoothness claim. |

## Local development

Use Node **24.19.x**. From the repository root:

```sh
npm ci
npm run build:extension
npm run dev:web
```

The website runs at **http://127.0.0.1:5174**. `npm run build:web` writes `dist/web`. No website account or backend is required. The extension remains loaded unpacked from `dist/extension`; reload it in Chrome and refresh website tabs after rebuilding.

The legal operator is **ILUNỌNSEN LLC**, **Ohio, United States**, with public contact **info@ilunonsen.com**. Operator/contact details were reviewed against the [corporate website](https://ilunonsen.com/); jurisdiction was supplied by the user. Corporate-site processor claims are not copied into the Tholi drafts. Set `VITE_THOLI_PUBLIC_ORIGIN` only after a real public origin is selected. An absent value remains explicitly unconfigured.

## Genuine recording and provenance

Regenerate with a frozen normal extension build:

```sh
npm run capture:video
```

The default attempts **“Open this repository’s pull requests.”** on public GitHub, then uses the explicitly labeled **“Make the text larger”** Wikipedia workflow if fresh evidence does not support the first take. To reproduce only the chosen workflow:

```sh
npm run capture:video -- --workflow=wikipedia
```

The current demonstration uses the Wikipedia fallback. It does not establish reliable GitHub navigation. No engine workaround, fabricated outcome, generated cursor or recreated control is added to make a recording pass.

`scripts/capture-product-video.mjs` launches the actual built extension in a disposable Chromium profile. It warms discovery before starting `page.screencast`, records the visible floating widget and public website, performs normal website interactions, and accepts the take only after the worker reports fresh verified completion. The extension asset list must be unchanged across the capture run. A disposable GitHub host pregrant does not validate native Chrome permission activation.

Generated files live under `apps/public/media/video/`:

- Light/dark **1440 × 960, 30 fps, VP9 WebM** variants, each bounded to **5 MB**.
- Lightweight WebP posters, descriptive English VTT captions and a plain-text transcript.

- `manifest.json` for playback and `provenance.json` with source, request, attempted workflows, observed outcome evidence, extension build hash, asset list and media hashes.

The showcase player no longer mounts a caption track, as requested, so text cannot cover the recorded interface. The transcript link remains available. Original VTT files remain in the recording provenance archive. This small presentation change follows Baseline UI’s clarity and restraint guidance; validation uses the existing real-recording browser case and website build.

Both variants use the website's genuine appearance controls. Captured UI is not recolored. Existing genuine screenshots and their independent provenance remain under `apps/public/media/screenshots/`; `npm run capture:web` regenerates those separately.

Visible video loops muted on desktop and mobile, with a single Pause/Resume control. Native controls, the progress bar, the central play overlay, Replay and Fullscreen are removed. Offscreen playback suspends and resumes on return unless manually paused. Manual pause and playhead survive appearance changes. Reduced-motion and data-saving views start with a poster and explicit Resume. Transcript and practice remain available if media fails. The complete recording remains framed rather than cropping away controls.

## Motion and identity

The About stage cycles the shared marker through idle, planning, guiding, verifying, attention, paused, arrived and unresolved states. State labels explain each scene. The sequence loops automatically without a state selector or playback controls, suspends offscreen, and stays static with reduced motion. The sequence is explicitly a brand-motion demonstration and cannot update a real journey.

On wide Home layouts, one decorative amber point follows the empty outer gutter, descends with scrolling and exits near the footer. It never intercepts input. Native scroll timelines are preferred; unsupported browsers use one requested animation frame for direct element style updates. There is no React state update per scroll frame. Narrow and reduced-motion layouts keep a stationary equivalent. Observers, frames and media listeners clean up on route changes.

## Public documentation and routing

`features/docs/registry.ts` explicitly allowlists eleven current references: getting-started, using-tholi, journeys, sessions, appearance, troubleshooting, security, architecture, natural-language, backend and contributing. These pages load lazily. Search is local to the bundled references and never becomes an analytics property.

`react-markdown` **10.1.0** and `remark-gfm` **4.0.1** render GFM without raw HTML. Heading anchors are stable, duplicate labels receive unique suffixes, and code-fence text does not become a heading. Registered Markdown links resolve to public article routes; other references resolve to repository sources. Dated validation reports remain historical evidence, not current workflow promises. Markdown images become source links rather than silently fetching remote images.

The router keeps pathname, query and fragment separate. It handles direct heading links, modified clicks and browser Back, retaining session scroll positions. Lazy routes receive focus only when their real heading or fragment mounts; a bounded observer is canceled on completion or navigation. An emulated or placeholder heading cannot stand in for an article.

## Cookies, analytics and legal drafts

| Storage                 | Behavior                                                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `tholi_consent`         | Necessary versioned choice record, 180-day lifetime, saved only after a choice. No navigation destination or authentication credentials.     |
| `tholi_theme`           | Optional Light/Dark preference, written only with preference consent and deleted on withdrawal. Its expiry cannot exceed the consent record. |
| Website session storage | Mock name/email/onboarding state only. Passwords stay component-local and are never sent or persisted.                                       |
| Extension stores        | Independent session context and local learned knowledge. Website cookie settings do not erase them.                                          |

Cookies are first-party, host-only, `Path=/`, `SameSite=Lax` and Secure on HTTPS. HTTP localhost is a local-preview exception to the Secure flag. Essential only and Allow preferences have equal access, and footer Cookie settings reopens the real controls. Silence grants no optional consent. With blocked or declined optional storage, appearance remains usable in memory.

Production analytics has **no configured provider**, scripts or endpoint. The consent-gated provider boundary is testable but inactive in production. A future provider requires its identity, disclosure revision and fresh provider-specific consent. The eligible event vocabulary is limited to page views, download clicks and practice start/completion. It excludes arbitrary destinations, chat, account information, document queries and extension observations. Withdrawal aborts queued/in-flight optional work where supported and rejects future sends. See [ICO practical consent guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/how-do-we-manage-consent-in-practice/).

`/privacy`, `/terms` and `/cookies` are visibly **launch-review drafts** written from actual product behavior. Hosting, provider selection, public domain and final legal review remain incomplete. They distinguish website storage and mock accounts from extension-local knowledge, temporary masked OCR and explicit optional backend connections. They preserve MIT software rights and explain deletion boundaries without claiming universal legal certification.

## Verification and remaining checks

During implementation, the strict TypeScript check and all **249 unit tests** passed. A real localhost HTTP endpoint test confirms that the prepared analytics transport sends nothing before matching provider consent and nothing after withdrawal. Production still has no provider.

Computed WCAG contrast for the actual token pairs: dark body 16.45:1, dark secondary 9.86:1, dark links 9.29:1, dark primary label 8.41:1; light body 14.68:1, light secondary 6.26:1, light links 5.95:1, light primary label 6.37:1. The product-chapter secondary text is 6.82:1 and footer secondary text is 10.42:1. These checks cover the named palette pairs, not every rasterized video pixel or browser UI.

The integrated browser pass already covered all 96 route/width/theme combinations, practice and mock accounts, documentation, cookie recovery and both recording variants. Final reporting additionally hashes the website source, HTML and built assets alongside the existing extension hashes. The explicit full UI gate is **29 cases**; its final result is recorded below after media and build bytes are frozen.

Focused documentation/router unit checks passed during implementation, including unsafe Markdown, source routing, direct fragments, Back and delayed lazy content. Cookie/provider tests and integrated browser tests have separate reports. Final aggregate counts and byte-matching release results must be filled from the final run, not copied from earlier source versions.

`tests/ui/website-docs.spec.ts` adds three browser cases: documentation interaction; launch drafts and actual cookie opt-in/withdrawal; and a 96-combination route matrix across **320, 375, 768 and 1440 pixels** in both appearances. Four selected screenshots and a JSON layout attachment accompany that matrix. Other UI cases retain practice, account, download, media, extension safety and motion checks.

Run focused checks during development, then TypeScript, units, builds and the complete UI suite against the same final extension bytes. `tests/support/ui-reporter.ts` and the existing packager must agree on the complete explicit case count. Running a focused subset cannot certify the release gate. The download remains 0.10.0 until a newer archive passes its original packaging requirements.

Native Chrome permission/docking, actual screen-reader speech, native browser zoom and signed-in workflows remain separate checks unless explicitly recorded. A narrow viewport is a responsive fixture, not a native Chrome zoom check. Motion timing from a disposable browser is reported with its hardware/workload, never as universal smoothness. No public deployment or live analytics activation has been performed by this pass.

### Final automated result

- Strict TypeScript: passed. Unit suite: **249/249**, including the genuine-media hashes/frame checks and a real localhost analytics endpoint.
- Website production build: passed. Route splitting leaves an initial JavaScript chunk of **487.93 kB**, **152.55 kB gzip**; documentation and secondary routes load separately.
- Complete UI suite: **29/29 passed in one run**. `output/qa/ui-build.json` records `passed: true` and unchanged start/end hashes for all **176 extension files**, **38 built website files**, **41 website source files**, and the website HTML.
- The responsive matrix covers **96 combinations** across twelve routes, four widths and both themes. Representative screenshots were reviewed, including the genuine video and transparent About stage.
- Final footage: light **15.0 s / 4,493,038 bytes**, dark **14.1 s / 4,272,016 bytes**, VP9 at **1440 × 960 / 30 fps**. Both show a genuine fresh Large-control binding, requested Wikipedia preference state, worker completion and the visible amber completion check. Every source frame has the expected viewport size.
- Existing download remains the gated **0.10.0** archive. No replacement ZIP or public deployment was produced. Frozen NLP and Wikipedia inputs were not modified; this is not a new full engine release certification.

The final harness uses a fresh renderer for each width/theme group, avoiding Chromium resource exhaustion from 96 consecutive Vite document reloads. Footer measurements wait for the actual lazy route, its download result and fonts. The existing launcher fixture allows 15 seconds for its initial cold-model binding. The 50,000-node benchmark has a bounded 90-second wall-clock budget so it can collect all 120 samples. Workloads, assertions, reminder counts, safety checks and frame-time reporting remain intact. These changes do not extend or disguise user-facing task timeouts.

### Measured performance limits

Hardware: **AMD Ryzen 7 5700U with Radeon Graphics**, 16 logical CPUs, Windows, automated Chromium. Website viewport: **1440 × 1000**. These are observed animation-frame callback intervals with browser-test/trace overhead and uncontrolled background load, not a guarantee of compositor frame rate.

| Final measurement                                                             | Frame interval p95 | Interpretation                                                                                    |
| ----------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------- |
| Active shared website guidance orbit, 90 samples                              | 33.3 ms            | Functional motion passed, but this run did not sustain 60 Hz callbacks.                           |
| Same orbit with 12 ms scripting every sixth frame, 90 samples                 | 33.3 ms            | Synthetic load is reported rather than certified smooth.                                          |
| Shared route activity with 4 ms scripting per frame                           | 16.8 ms            | This smaller workload stayed near 60 Hz callbacks.                                                |
| Existing extension fixture, 50,000 nodes and sustained mutations, 120 samples | 716.6 ms           | Severe busy-page performance remains unresolved. Discovery/routing was outside this website pass. |

Earlier runs varied, including 16.8 ms normal website p95, 83.4 ms synthetic-load p95 and 333.4 ms on the large extension fixture. The variability and final slow results remain visible here; the passing functional suite is not a claim that busy dashboards are now smooth or accurate. Native Chrome, native zoom, screen-reader and authenticated workflow checks remain pending, as do hosting/provider selection and final legal review.

### Playback simplification, October 16, 2026

Applied the local Animate skill’s explanatory-motion guidance: retain existing marker morphs, run the requested continuous sequence only while visible, preserve reduced-motion behavior, and clean up timers and media observers. Website playback uses the native video loop with one accessible Pause/Resume button; captions remain absent. Validation passed: TypeScript, the production website build, and both focused browser cases covering looping, pause retention, appearance changes, mobile playback, reduced motion and the complete marker sequence (2/2). This small change does not recertify the earlier full release gate.

### Theme-aware explanation chapter, October 16, 2026

The three-step section previously forced ivory and light-theme text colors in both appearances. It now uses the `--web-explanation` chapter token: the existing dark card surface in Dark mode, and warm ivory in Light mode. Text, accents and separators inherit the selected appearance. This applies Apple Design’s local `dark-mode.md` guidance to use adaptive colors and UI UX Pro Max’s contrast guidance, without adding motion or changing navigation.

Disposable-browser checks and screenshots cover 1440 px and 375 px in both themes. Minimum measured text contrast is **7.94:1** in Dark and **5.48:1** in Light. The website build passes. The complete release suite was not rerun for this color-only fix; the preceding full audit remains historical evidence for its own bytes.
