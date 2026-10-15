# Tholi UI

The current source is **0.10.1**. See [the refinement record](ui-refinement.md) for installed skill provenance and motion decisions, and [frontend architecture](frontend-architecture.md) for source ownership. The existing downloadable ZIP remains 0.10.0.

Tholi uses the supplied brand artwork and a warm minimal design across the sidebar, floating widget, and local website. The default is Guide mode in Chrome's sidebar, with Advanced off. Internal package identifiers, API contracts, IndexedDB knowledge, and saved routes remain compatible.

The extension automatically uses a light palette on dark websites and a dark palette on light websites. The sidebar, widget, and page guidance follow live website changes while retaining the task. Restricted pages use the system palette. See [adaptive appearance](adaptive-appearance.md) for detection, permissions, privacy, and limitations.

## Use the extension

Build with `npm run build:extension`, then load `dist/extension` in `chrome://extensions`. After rebuilding, reload **Tholi** and refresh the website tab. Confirm version **0.10.1**.

Enter a destination and select **Guide me**. The current instruction, notices, and Pause/Stop stay together. Saved journeys and route details are disclosures. The settings button reveals an explicit Advanced toggle and the surface choice.

**Conversation** uses the existing local NLP and verified navigation events. It accepts destinations, supported corrections and references, grounded clarification replies, and navigation commands. “Why this step?” explains available route evidence. It does not simulate a cloud LLM or stream invented reasoning. The draft survives view changes; the last 80 messages remain in trusted browser-session storage. Stop cancels navigation without deleting conversation history.

**Floating widget** starts at 360 × 420 CSS pixels, with a minimum of 240 × 180 where the viewport permits. Drag its top bar or resize its corner. The focused move handle supports arrow keys, and Shift plus arrow keys resize. The resize handle also supports arrow keys. The shell’s Layout menu offers position and size buttons without dragging. Reset restores the standard bounds; Expand restores the standard size. The settings menu offers Move aside and Use sidebar. Compact layouts retain the instruction and Pause/Stop and collapse secondary content.

The widget registers with a fresh capability mounted inside the authorized top document's closed shadow root. Chrome's runtime tab, frame, and document identity are checked against the session. Extension frames are omitted from Chrome's website frame inventory, so their identity comes from the runtime sender, with the parent document separately checked. Widget commands cannot access backend settings or credentials. Local extension storage is restricted to trusted contexts; the authorized page shell saves only validated widget bounds through the worker. If the frame cannot load, Tholi keeps the task in the sidebar. Old Chrome versions without native panel close show a specific closing instruction.

## Motion and feedback

Highlight nodes remain stable while geometry updates. Entry is 180 ms; exit is 120 ms. Four gentle 1.2-second glow cycles begin after four idle seconds, once per fresh step. Interaction and review boundaries cancel the reminder. Scroll arrows travel in the relevant direction for three 900 ms cycles and then remain static. Instruction changes use a 160 ms fade with a small entry movement; the activity indicator waits 200 ms to avoid flicker. Verified arrival uses one short 420 ms animation.

Reduced motion replaces movement and repeated cues with static guidance. Animation never determines completion. Tholi surfaces are excluded from discovery and outcome evidence and hidden during OCR capture. Fields and inaccessible frames retain their existing masking.

### Widget scrolling and pause recovery

The widget document is confined to its iframe. Conversation following updates only the secondary content scroll area, so it cannot scroll the header or current guidance out of view. History no longer introduces a second nested scrollbar. The current instruction has its own bounded content area with Pause/Resume and Stop outside it. Compact mode keeps those actions visible.

Resuming a review-blocked live request replaces the previous paused instruction with the retained plan reason before fresh observation. This changes feedback only; it does not clear the review boundary or establish completion. The widget regression includes long persisted history, composer focus, visible header/current guidance, and paused-state controls. The full UI suite now contains eleven cases, including adaptive appearance.

Before adaptive appearance was added, 179 unit tests and all ten UI browser checks passed on the rebuilt 0.10.1 extension. With adaptive appearance, strict TypeScript checks, 182 unit tests, and all eleven UI browser checks pass. The UI report binds to the current extension build bytes. Native Chrome and signed-in workflow verification remain separate.

## Local website

Run `npm run dev:web` and open **http://127.0.0.1:5174**. Build the static site with `npm run build:web` into `dist/web`.

The website includes product information, an explicitly labeled interactive demonstration, installation instructions, sign-up/sign-in mocks, optional onboarding, and a welcome area. Mock account state uses browser-session storage. Passwords are never persisted or sent. Website preview preferences do not configure an installed extension. No account is required to download or use Tholi.

Download metadata is generated from existing gated archives by `scripts/sync-downloads.mjs`. The archive's SHA-256 is checked before copying. The page identifies its actual version and whether it precedes the current UI. New archives become eligible only after the unchanged release gates plus the new UI gate pass. Existing archives are not overwritten. There is no Chrome Web Store listing or deployment in this pass.

## Design references and verification

The design follows the supplied Tholi brand direction and reviewed [Apple design skill](https://github.com/dickwu/apple-design-skill), [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill), and [Emil Kowalski's animation skills](https://github.com/emilkowalski/skills). The UI Pro Max design-system search supported minimal layouts; the supplied brand palette takes precedence over its generic palette. Runtime dependencies are pinned: Iconoir React 7.12.1, Base UI 1.9.0, and Inter via Fontsource 5.3.0. No motion framework or runtime font CDN is used.

`npm run test:ui` covers view continuity, real widget pointer interaction, frame isolation, capture exclusion, interrupted widget-mount recovery, busy-page motion, responsive layouts, large text, reduced motion, mock onboarding, and download integrity. Its report binds to recursive extension asset hashes in `output/qa/ui-build.json`. Run final release suites after the last build; rebuilding invalidates prior byte-specific reports.

Browser fixtures establish fixture behavior. Native Chrome permission/screen-reader checks and signed-in Amazon, Cloudflare, and GitHub checks remain pending. A UI redesign does not establish universal routing accuracy.

The UI suite starts its own preview server. Leave port 5174 free before running it; it does not attach to or stop an existing user preview. See [the 0.10.0 validation record](v0.10.0-validation.md) for measured results and delivered artifacts.
