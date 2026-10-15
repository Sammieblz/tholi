# Frontend architecture

Tholi 0.10.1 separates application setup, feature interfaces, transport, and reusable presentation. The worker owns journeys. Switching interfaces never creates a second journey.

```text
apps/web/src/
  main.tsx                    React mount, global style order, providers
  app/                        Routing, browser history, section entrances
  components/SiteLayout.tsx    Header, accessible mobile navigation, footer
  features/
    account/                  Mock auth, session state, welcome, styles
    demo/                     Sample workspace and interactive walkthrough
    downloads/                Manifest loading, download button, setup page
    marketing/                Home/about content and layout
    onboarding/               Skippable walkthrough and preview preferences
  styles/                     Shared website layout and motion

apps/extension/src/
  sidepanel.tsx               Sidebar/widget mount and frame registration
  ui/
    app/
      useGuidanceController.ts Worker transport, lifecycle, user commands
      GuidanceController.tsx   Feature composition and blocking guidance
      presentationLabels.ts    Shared plan labels
    features/
      advanced/               Model/backend settings, diagnostics, inspector
      journey/                Queue, saved journeys, workflow details
    widget/                   Isolated page shell, bounds, gestures, styles
    theme/                    Page agent, document handshake, palette updates
    styles/                   Extension-only advanced controls
  ui-transport.ts             Trusted worker commands and presentation storage

packages/ui/
  guidance.tsx                Stable component/preferences exports
  presentation.ts             Pure presentation and conversation helpers
  page-theme.ts               CSS background sampling and tone classification
  guidance/                   Header, current step, composer, conversation
  motion/                     Shared input-modality behavior
  styles/                     Theme tokens, guidance layout, motion grammar
  tokens.css                  Stable stylesheet entry

packages/overlay-ui/
  guidance-overlay.ts         Page-bound highlight, reminder, scroll direction
  overlay-styles.ts           Scoped overlay palette and visual styling
```

## Ownership and extension points

- Website features own components and styles. Shared layout belongs in `styles/site.css`; brand tokens and easing come from `packages/ui`. Marketing entrances belong on the website, not daily guidance controls.
- Mock passwords remain component-local and are discarded after form completion. Only name, email, and onboarding state enter website session storage. Downloads require no account.
- The extension controller hook owns transport and lifecycle. Feature components receive typed state/actions without opening duplicate polling or inference sessions. Privileged configuration remains sidebar-only.
- `packages/ui` has no Chrome calls or navigation discovery. Its appearance helper samples computed CSS backgrounds only. Both surfaces receive the same presentation and callbacks. Keep the stable `guidance` and `tokens.css` entries when adding shared components.
- Widget shell code owns geometry and pointer capture. The extension-origin iframe owns guidance. The shell's closed-shadow styles remain isolated; Layout buttons and keyboard controls complement dragging.
- The overlay owns fresh geometry. Never interpolate between unrelated website controls. Tholi surfaces remain excluded from discovery and OCR captures.
- Keep API contracts, storage, and outcome criteria outside UI features. A rendered state cannot establish success.

Add pages to `app/App.tsx` and use `SiteLink` for client navigation. It preserves modified clicks and browser Back. Feature CSS stays colocated. Keep state at the lowest useful owner and use composition before adding global context. New engine phases need pure presentation mappings and continuity checks. Polling, geometry, and confidence updates must not replay attention effects.

## Development

`npm run dev:web` serves port 5174. `npm run build:web` emits `dist/web`; `npm run build:extension` emits `dist/extension`. Run TypeScript, unit, and UI checks with `npm run typecheck`, `npm test`, and `npm run test:ui`.

The UI suite owns its server. To leave an existing preview alone:

```powershell
$env:THOLI_UI_PORT = '5184'
npm run test:ui
```

Remove that environment variable afterward for the default port. See [skill application and motion](ui-refinement.md) and [release requirements](../CONTRIBUTING.md).
