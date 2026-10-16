# Tholi interface and local website

The current source is **0.10.1**. See the [audit and implementation record](ui-audit-redesign.md), [frontend ownership](frontend-architecture.md), and [project-local skills](../.codex/README.md). The gated website download remains **0.10.0**, labeled separately from source.

## Build and use

```sh
npm ci
npm run build:extension
npm run dev:web
```

Load `dist/extension` using **Load unpacked** in `chrome://extensions`. After rebuilding, reload Tholi and refresh the website tab. The local website runs at **http://127.0.0.1:5174**; `npm run build:web` produces `dist/web`. No backend or account is required.

Guide/sidebar with Advanced off remains the default. Enter a destination and select **Guide me**. The 56-pixel journey summary expands into verified progress and route details. Required decisions temporarily replace the sidebar's route summary, progress and transcript with one scrollable decision area. Review and authentication instructions stay beside their required controls; generic clarification text is replaced by the actual question. The composer and Pause/Stop remain below this area. Answering restores the retained journey and conversation. Verified arrival offers **New destination**, without Pause or remaining-click estimates.

Long clarification choices wrap into full-width buttons. On short sidebars, smaller spacing and a shorter composer reserve room for the decision; mode tabs are temporarily hidden while that decision is required. Scrollable content cannot paint over the anchored controls. Keyboard focus scrolls the question area, not the entire sidebar.

Conversation centers the transcript rather than repeating the Guide card. It uses existing local NLP and actual navigation events. Enter sends; Shift+Enter adds a line. Navigation commands, compatible corrections/references, grounded clarification replies, copying guidance, and **Why this step?** are supported. Unsupported questions do not produce invented answers. Switching modes retains the draft and task. The latest 80 messages remain in trusted browser-session storage.

## Widget and continuity

Choose **Use floating widget** in settings. Default size is 360 × 420 CSS pixels, minimum 240 × 180 where the viewport permits. The shell contains the drag handle, name and Close action. Drag the handle, use arrow keys to move, Shift+arrow keys to resize, or open **Widget menu** for labeled placement and size controls. **Reset position** restores the default bounds. **Expand widget** requests 420 × 620, clamped to the viewport.

Layout uses both available width and height inside the shell. Shrinking removes secondary controls immediately; growing requires a 12-pixel buffer beyond the next threshold to avoid flicker near a boundary.

| Layout   | Available width and height     | Visible priorities                                                                                           |
| -------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Expanded | At least 400 × 560             | Mode switch, journey summary, step nodes or transcript, instruction, composer and session actions            |
| Standard | At least 340 × 360             | Compact destination summary, estimated step caption, instruction or transcript, composer and session actions |
| Compact  | At least 280 × 240             | One current message, composer, inline Send and Widget menu                                                   |
| Minimal  | Either dimension below Compact | One current message, short composer, inline Send and Widget menu                                             |

Pause/Resume/Stop move into Widget menu in Compact and Minimal. Mode selection, route details, settings, placement, resizing and docking remain in that menu. Enter sends in the compact composer; Shift+Enter adds a line. Draft, focus, selection, mode and conversation survive resizing. Stopped/idle widgets remove the old journey card, route progress and return instructions instead of repeating an obsolete task.

Required questions and access notices take the message area. **Review details** opens their full controls and requests usable expanded bounds, without automatically resizing when the prompt first arrives. The composer remains mounted. Secondary content scrolls independently; the widget frame itself cannot scroll under its title bar.

The shell's **X minimizes to a 44-pixel launcher**. Objective, queue, milestones, draft, and conversation remain in the current browser session. Authorized observation and verification continue; expanded highlights, coach bubbles, reminders, and automatic guidance scrolling are suppressed. The launcher indicates attention or arrival without displaying the destination. Restore reacquires fresh observation before guidance. Session updates and supported document transitions do not reopen the minimized widget.

**Double-click the floating widget launcher** to reveal **Remove**. Right-click or focus it and press **Shift+F10** also opens its controls; Escape dismisses them. Remove hides the launcher entirely and retains the task, draft and conversation. This hidden state survives reloads and worker restart. Click Tholi's Chrome toolbar icon to reopen it. Single-click widget restoration waits 400 ms to distinguish it from a double-click; keyboard activation remains immediate. A native sidebar launcher opens immediately to preserve Chrome's required user gesture, with removal available through right-click or Shift+F10.

Dragging within 24 pixels of the right viewport edge shows a docking preview. Release requests the native sidebar immediately; the widget disappears only after Chrome accepts. Chrome uses the browser's configured panel side. Rejected activation retains the widget and an explicit **Dock to sidebar** action. Native lifecycle events are feature-detected; a disconnected UI port is not treated as dismissal.

**Stop** cancels navigation while keeping visible history. **Reset current session** clears unfinished journeys, draft, and conversation after confirmation. Learned website knowledge and saved routes have separate trash actions. Closing Chrome ends private session continuity.

The extension-origin iframe is capability-bound to the authorized tab, top document, frame, and session. Stale commands are rejected. Backend credentials remain sidebar-only. Tholi surfaces stay excluded from discovery/outcome evidence and hidden during OCR capture; existing field/frame masking remains.

## Appearance and motion

The supplied wordmark remains intact. Manrope is bundled for interface/body text and Outfit for marketing headlines. Iconoir and Base UI supply functional icons and interaction primitives. No font CDN or general animation framework is added.

The shared Wayfinder uses a slow 3.6-second idle breath that settles while typing. Planning and guidance show a continuous amber waypoint orbit, with a short fading trail, compass ticks and a shaded center. Planning uses a 1.8-second orbit; guidance uses 2.8 seconds. Verification has separate checking activity. On verified arrival or a settled unsuccessful search, the ball separates into two amber pieces and unfolds into a standalone check or X over 420 ms. No ball or contact shadow remains behind the symbol. The resulting shape becomes still. Returning to the view, polling and theme changes do not replay the morph; reduced motion shows the final shape directly. Attention and pause keep their distinct still markers. Automatic recovery and pending indexing keep searching. Progress never invents percentages.

A compact horizontal step path stays below the journey summary in both Guide and Conversation. Numbered nodes represent known live/predicted steps; verified interactions become checks. The current segment carries a continuous 2.4-second signal. Finite counts are labeled estimated; incomplete forecasts include an open-ended node and “More may appear.” Long journeys show the latest verified step, a summary of earlier steps, and a bounded window of upcoming steps. The destination becomes a check only on verified arrival. Pause, review, authentication, unresolved recovery and hidden surfaces stop activity. Reduced motion keeps static nodes and lines. Keyboard use suppresses interaction transitions without disabling necessary navigation activity.

Highlight DOM nodes remain stable while geometry updates. Entry/exit use 180/120 ms, instructions 160 ms, and disclosures approximately 200 ms. Four 1.2-second reminder cycles begin after four idle seconds on a fresh step, then stop. Directional arrows travel three 900 ms cycles. Arrival lasts at most 450 ms. Geometry, polling, and theme updates do not replay transitions. Reduced motion uses static shapes and brief fades; interaction never waits for animation.

Required decisions remain until resolved. Passive notices use a four-second toast. Scrollbars retain stable gutters and appear on scroll, hover, or keyboard focus, with accessibility fallbacks. [Inverse website-theme adaptation](adaptive-appearance.md) remains unchanged.

## Website and demonstration

Home, About, Download, Sign-up, Sign-in, Onboarding, and Welcome are local routes. Documentation adds `/docs` and an allowlist of current `/docs/:slug` Markdown references. `/privacy`, `/terms`, and `/cookies` are Tholi-specific launch-review drafts for ILUNỌNSEN LLC in Ohio, United States. A selected production host, analytics provider, public Tholi domain and final legal review remain launch work. Mock accounts are visibly labeled; passwords are neither sent nor persisted. Downloads and extension use require no account.

The website starts in Dark regardless of OS appearance and provides an explicit Light/Dark control. A necessary `tholi_consent` cookie remembers choices for 180 days; optional `tholi_theme` remembers appearance only after preference consent. Essential only, Allow preferences and Settings are actual controls. Withdrawing preferences removes the theme cookie. Without optional storage, appearance works in memory. Production analytics remains unconfigured and inactive, with a tested consent boundary for a future disclosed provider. Website preferences are separate from the installed extension.

The demonstration mounts the actual shared guidance app inside an isolated shadow root. Its controlled workspace offers two tasks: find account settings and change the sample language to Spanish. Actual sample interactions verify the outcome. Guide/Conversation, Pause/Resume/Stop, and onboarding mode selection work without configuring an installed extension. The practice adapter does not establish live-site routing accuracy.

Genuine extension screenshots include provenance and enlargement controls. Installation illustrations are annotated schematics rather than invented Chrome screenshots. Downloads distinguish loading, available, unavailable, and failed states, with retry on failure. Version and SHA-256 come from the gated archive manifest. New archives require all existing release gates against matching bytes.

Home pairs distinct charcoal, jade and ivory chapters with a real extension recording, followed by the shared practice and genuine screenshots. Capture tooling first attempts public GitHub Pull requests and uses the explicitly labeled Wikipedia text-size workflow when that request cannot be verified. Media acceptance requires both a real worker outcome and unchanged extension build bytes; it is not a claim of reliable GitHub or signed-in navigation. Light/dark VP9 WebM variants, posters, captions, transcript and provenance are served locally. Visible recordings loop muted on desktop and mobile, with one Pause/Resume control. Manual pause persists across scrolling and appearance changes. Reduced-motion and data-saving views require explicit Resume. Captions are not displayed; the transcript remains available.

The About Wayfinder stage has a transparent background and an automatically looping sequence of labeled states, with no controls. It suspends offscreen and remains static with reduced motion. It is clearly identified as a brand-motion demonstration, not live task progress. Home's decorative desktop point follows the outer gutter without intercepting input; narrow and reduced-motion layouts keep a static equivalent. Product headings, selected explanations and the closing action use purpose-specific entrances rather than identical section fades. See [the website implementation and verification record](website-redesign.md).

## Verification

Run `npm run typecheck`, `npm test`, builds, and `npm run test:ui`. The UI suite owns its preview server; set `THOLI_UI_PORT=5188` when an existing 5174 preview must remain running. Its report binds to recursive extension asset hashes. Rebuilding invalidates earlier reports.

See the [audit record](ui-audit-redesign.md) for measured evidence and pending checks. Native Chrome permissions/docking, screen readers, and signed-in workflows remain separate from fixtures. This redesign does not establish universal website routing accuracy.
