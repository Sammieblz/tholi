# Frontend architecture

Tholi separates application setup, feature interfaces, transport, and reusable presentation. The worker owns journeys. Switching interfaces never creates a second journey.

```text
apps/web/src/
  main.tsx                    React mount, global style order, providers
  app/                        Routing, browser history, section entrances
  components/SiteLayout.tsx    Header, accessible mobile navigation, footer
  config/project.ts           Repository links derived from root package metadata
  features/
    account/                  Unrouted mock drafts, excluded from production imports
    demo/                     Sample workspace and interactive walkthrough
    downloads/                Manifest loading, download button, setup page
    docs/                     Allowlisted repository Markdown, safe GFM, search
    legal/                    Operator configuration and launch-review drafts
    preferences/              First-party cookie choices, theme, consent-gated analytics boundary
    marketing/                Home/about, genuine video, brand-motion stage and scroll companion
    onboarding/               Optional account-free installation and isolated practice
  styles/                     Shared website layout and motion

apps/extension/src/
  entries/                    Stable browser entrypoints
  background/                 Session, journey, memory, frame and vision services
  content/                    Observation, PageCoach and outcome verification
  inference/                  Bundled NLP/OCR and optional browser model
  platform/                   Host grants and backend adapters
  ui/
    app/
      useGuidanceController.ts Composition and user commands
    hooks/                    Snapshot subscription, draft hydration, settings
      GuidanceController.tsx   Feature composition and blocking guidance
      presentationLabels.ts    Shared plan labels
    features/
      advanced/               Model/backend settings, diagnostics, inspector
      journey/                Queue, saved journeys, workflow details
    components/               Base UI disclosures and destructive confirmations
    widget/                   Isolated shell, bounds, gestures, surface visibility
      launcher-controls.ts    Launcher activation, dismissal controls and cleanup
    theme/                    Page agent, document handshake, palette updates
    styles/                   Extension-only advanced controls
  background/ui-transport.ts  Trusted commands and presentation storage

packages/ui/
  guidance.tsx                Stable component/preferences exports
  presentation.ts             Pure presentation and conversation helpers
  route-progress.ts           Grounded, bounded step-path presentation
  widget-density.ts           Width/height tiers, expansion buffer, layout action names
  page-theme.ts               CSS background sampling and tone classification
  guidance/                   Header, current step, route nodes, composer, conversation
    useWidgetDensity.ts       Observe usable frame size without resetting UI state
    WidgetAttention.tsx       Compact required prompt and persistent full controls
  WayfinderMark.tsx            Shared state marker; wayfinder.ts also serves shell
  motion/                     Shared input modality and visible-loop suspension
  styles/                     Theme tokens, guidance layout, motion grammar
    widget.css                Widget-only density rules and composer space
  tokens.css                  Stable stylesheet entry

packages/overlay-ui/
  guidance-overlay.ts         Page-bound highlight, reminder, scroll direction
  overlay-styles.ts           Scoped overlay palette and visual styling
  presentation-gate.ts        Suppresses visual guidance without stopping evidence
```

## Ownership and extension points

- Website features own components and styles. Shared layout belongs in `styles/site.css`; brand tokens and easing come from `packages/ui`. Marketing entrances belong on the website, not daily guidance controls.
- `preferences` owns consent, pre-paint website appearance and the optional analytics boundary. The default has no app analytics provider. The event allowlist excludes arbitrary text and extension data. Cloudflare's live host injects its own measurement script outside that boundary; app cookie choices do not control it. Website Light/Dark preferences do not configure the extension's inverse-theme adaptation.
- `docs` owns an explicit Markdown registry, local search, safe GFM rendering and reference-link mapping. Raw HTML is disabled and images become source links. `legal` owns operator configuration and Tholi-specific launch-review drafts. Both route bundles are lazy-loaded; repository Markdown stays out of the initial Home bundle.
- `marketing` loads a recording manifest rather than embedding recreated product UI. Capture tooling accepts only a real worker-verified public-page result and records immutable extension/media hashes. Brand-motion demonstrations emit no journey or completion evidence.
- The public app mounts no mock account provider and imports no account screens. Legacy account URLs replace their history entry with `/download`. Native store links use the canonical browser configuration independently of ZIP metadata, cookies and account state. Developer metadata loads only when its disclosure opens. Optional onboarding cannot own extension state or confirm installation.
- The controller composes feature actions and dedicated session hooks. Feature components receive typed state/actions without opening duplicate polling or inference sessions. Privileged configuration remains sidebar-only.
- Draft restoration checks local edit revisions before applying a session snapshot. Local edits stay protected from restoration until the matching `UI_SAVE` acknowledgement; older reads and replies after unmount cannot overwrite current typing. A surface handoff can restore a clean draft without changing the worker-owned task.
- `packages/ui` has no Chrome calls or navigation discovery. Its appearance helper samples computed CSS backgrounds only. Both surfaces receive the same presentation and callbacks. Keep the stable `guidance` and `tokens.css` entries when adding shared components.
- Widget shell code owns geometry and pointer capture. The extension-origin iframe owns guidance and its single Widget menu. Typed layout requests pass through trusted UI transport to the matching session's top frame; the shell validates the action and returns clamped bounds. Closed-shadow styles remain isolated. Keyboard controls complement dragging.
- Widget density depends on both usable dimensions, with immediate reduction and buffered expansion. Shared components remain mounted across tiers; CSS suppresses secondary controls while the composer retains its draft, selection and focus. Required prompts open their full controls explicitly. The widget root clips rather than becoming a programmatic scroll container.
- `current-task-notices.ts` gates retained route actions by current task status and presentation phase. Stopped, paused, completed and replanning views cannot revive old return, tab-switch or visual prompts. Current frame-access recovery is observation-scoped and remains available during active page exploration before a destination or while planning. Both paths require an active session. These presentation guards do not grant access or verify outcomes.
- A required sidebar decision owns the flexible middle region instead of competing with route chrome and the transcript. The retained workspace remains mounted but hidden until the decision clears. Semantic-content measurement excludes the promoted instruction, preventing duplicate-instruction detection from oscillating. Both normal and blocked scroll regions remain separate from the fixed composer; workspace clipping retains a six-pixel focus gutter.
- Session-scoped surface visibility is independent of the journey. Minimized visibility mounts a launcher; hidden visibility removes it entirely. Both gate frame-local overlays/scrolling while authorized observation continues. Hidden state persists through worker restart and document changes until explicit restore. Launcher shell commands require the current session and authorized top document. Restore requests fresh evidence; native docking must succeed before the expanded widget is removed.
- The website practice adapter mounts `GuidanceApp` with embedded rendering inside a shadow root. It owns sample outcomes, never Chrome permissions or production journey state. Website styles cannot alter product controls.
- The overlay owns fresh geometry. Never interpolate between unrelated website controls. Tholi surfaces remain excluded from discovery and OCR captures.
- Keep API contracts, storage, and outcome criteria outside UI features. A rendered state cannot establish success.

Add pages to `app/App.tsx` and use `SiteLink` for client navigation. The router separates pathname from query/fragment, preserves modified clicks, browser Back and session scroll positions, and waits for the actual heading or fragment when a lazy page mounts. Pending observers and animation frames are bounded and canceled on route changes. It does not create a placeholder heading or treat a fragment as a page name. Feature CSS stays colocated. Keep state at the lowest useful owner and use composition before adding global context. New engine phases need pure presentation mappings and continuity checks. Polling, geometry, and confidence updates must not replay attention effects.

## Development

`npm run dev:web` serves port 5174. `npm run build:web` emits `dist/web`; `npm run build:extension` emits `dist/extension`. Run TypeScript, unit, and UI checks with `npm run typecheck`, `npm test`, and `npm run test:ui`.

The UI suite owns its server. To leave an existing preview alone:

```powershell
$env:THOLI_UI_PORT = '5184'
npm run test:ui
```

Remove that environment variable afterward for the default port. See [the current audit, skill application and motion](../../releases/v0.10.1/ui-audit.md), [website ownership, media, consent and docs](../../releases/v0.10.1/website.md), and [release requirements](../../../CONTRIBUTING.md). Project-local skills and hashes live in `.codex`; they are development-only references.

Detailed ownership: [extension](extension.md), [website](website.md), [shared UI](shared-ui.md).
