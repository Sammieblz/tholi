# Adaptive extension appearance

Tholi automatically contrasts with the visible website: a dark website gets light guidance, and a light website gets dark guidance. This applies to the sidebar, floating widget, its drag/resize shell, and the page's highlight, instruction, and scroll cue. The Tholi product website has a separate Light/Dark switch and starts in Dark. It remembers that website choice only when preference storage is allowed. Website appearance never configures the installed extension.

## Detection and continuity

`packages/ui/page-theme.ts` samples a three-by-three grid across the viewport. It walks the visible elements' ancestors, composites transparent backgrounds, and classifies their median relative luminance. This lets a large dashboard surface outweigh a small navigation bar. Open shadow roots are included. Tholi surfaces are skipped so the detector cannot oscillate in response to its own interface. A small color-swatch canvas normalizes modern CSS colors, including `oklch()` and display-P3; it never copies website pixels.

Classification has a stability margin around gray surfaces. DOM style/class changes, stylesheet loads, scrolling, resizing, system-theme changes, and document restoration schedule a coalesced check after 200 ms. Visible documents also check every two seconds for CSSOM changes that do not emit DOM mutations. Busy pages cannot postpone a scheduled sample indefinitely. Hidden documents skip sampling; page exit disconnects observers and timers, with restoration supported for the back/forward cache.

The page agent is installed in Chrome's isolated world only where existing website access allows it. Its small entry point can run before navigation starts, without starting discovery or inference. The worker binds reads to the current top document. Theme notifications are checked against Chrome's sender tab, frame, and document identity. Appearance has a separate trusted UI read path, so it does not wait for navigation or inference jobs. The sidebar follows the active website; a widget follows its own authorized document. Unavailable or restricted pages clear the website override and use the system palette. No additional permission or backend is required.

Theme changes update presentation attributes without remounting the journey, changing step identity, or replaying attention animations. Foreground and background switch together, avoiding a color-transition flash on buttons. Press and movement feedback are retained.

## Privacy and limits

Detection reads computed background styling and geometry only. It does not read field values or text, capture screenshots, run OCR, persist website themes, collect browsing history, or send anything to a server. Only the resolved light/dark appearance crosses the extension bridge. Photographic backgrounds, canvas/video-only interfaces, unusual compositing, and closed shadow roots may not reflect their true visual tone. These use the accessible surrounding CSS surface and browser canvas appearance.

## Verification

Unit tests cover alpha compositing, luminance, predominant surfaces, and stability. The real-extension browser fixture checks contrasting palettes when the OS disagrees, dynamic theme changes without losing the request, consistent widget/shell/overlay styling, tinted application surfaces, modern CSS colors, stylesheet edits, tab changes, fresh documents, and restricted-page fallback. These fixtures do not certify native Chrome permission prompts or every website's visual design.

After building, reload Tholi in `chrome://extensions`, then refresh the website tab to replace older injected code.
