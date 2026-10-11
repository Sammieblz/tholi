# Native Chrome handoff — candidate 0.6.6

This candidate is for the dynamic Wikipedia proof of concept. It has not been published or committed. The versioned archive, SHA256 and evaluation provenance are generated in `output/releases` by `npm run package:extension`. Packaging requires a complete passing benchmark and byte-for-byte agreement with its evaluated build. The archive contains the production extension; extract it to a new folder and load that folder, or reload the evaluated `dist/extension` folder.

The native computer-use helper is unavailable in this work session (Windows native pipe not found after retry/reset; browser UI inventory is empty). Automated Chromium extension pages are not the native Chrome side panel. Actual screen-reader speech and Chrome permission dialogs remain unverified. Record the browser version, date and pass/fail details below before closing #10/#17/#18. The POC handoff remains pending until these checks pass, even when #14's measured gates pass.

| Native check                                                                                                                                                                        | Result / details |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Chrome version, extension version 0.6.6, date                                                                                                                                       | Pending          |
| `chrome://extensions`: Reload or Load unpacked; toolbar icon opens native panel without starting observation                                                                        | Pending          |
| Refresh existing Wikipedia tab to replace its old injected script; Start/Pause/Resume/Stop use the new build                                                                        | Pending          |
| Keyboard only: choose task, Start, enter goal, Find a route, Pause, Resume, Stop; visible focus, usable order and no trap                                                           | Pending          |
| Screen reader (name/version): guiding, waiting, choose an option, unresolved, verified, paused and stopped are announced once per meaningful change; polling does not repeat speech | Pending          |
| Narrow panel: read instructions/warnings and use controls without horizontal scrolling; consequential controls clearly require review                                               | Pending          |
| Browser zoom 80%, 125%, 200%: actual Wikipedia language highlight remains aligned and instruction readable                                                                          | Pending          |
| Ordinary HTTPS site without a prior grant: decline per-site access, see recovery text, retry granting only that origin; no all-sites grant needed                                   | Pending          |
| Restricted page (for example `chrome://extensions`): unsupported explanation and usable recovery                                                                                    | Pending          |
| English Wikipedia → explicit Français link: correct French article arrives, old-origin session stops, toolbar invocation/Start enables fresh destination observation                | Pending          |
| Stop clears guidance; Disable at `chrome://extensions` followed by website refresh removes injected content                                                                         | Pending          |

## Repeatable demo

1. Open `https://en.wikipedia.org/wiki/Casino_Royale_(novel)`, click the Navigator toolbar icon and Start **Navigate this website**. Keep optional AI off.
2. Enter **Make text larger**. Click the highlighted Appearance opener if needed, then Large. Confirm the website's selected option and Navigator's verified result agree.
3. Try **Switch to dark mode**, **Set width to wide**, **Find references**, and **Show search**. Search completion means the field is focused; you type and submit yourself.
4. Enter **Show languages**. Click the actual language button. Navigator should ask you to choose an option, with one verified menu-opening interaction. An open picker does not establish a completed language change.
5. Enter **Français** while the picker is open and click the highlighted link yourself. Independently check the French destination. Moving to its new origin ends the original session; click the extension icon there and Start again. Chrome may ask for access to that origin.
6. Pause/Resume and Stop. Inspect **Local site memory and AI**, and use Forget this website to stop observation and delete its learned structure.

The declared measured matrix is five English Wikipedia articles × six goal families × two layouts. Its URLs/oracles are test data, not product routes. The navigator uses the live page's semantic labels, descriptions and relationships and refreshes bounded IndexedDB knowledge. The Northstar cancellation/billing tasks remain controlled demo regression cases (`npm run dev:demo`, `http://127.0.0.1:5173`).

Reported Edit regression: enter **Edit** or **How do I edit this page?** on the article. The highlight should target the article toolbar's Edit link, rather than a section's edit link or an action-boundary refusal. A section-specific request uses its heading context. Opening an editor is distinct from publishing changes; committing controls still require the user to review the website. An opaque Edit button without declared navigation/popup behavior should say **Control effect unclear**. The live test verifies target/geometry; complete native editor behavior remains a hands-on check. Do not publish an edit as part of the handoff.

Top-document/open-shadow-root HTML and ARIA controls and English goal phrasing are supported. Scans retain up to 600 prioritized controls and disclose partial observations. Closed shadow roots, cross-origin frames, canvas controls, unlabeled/ambiguous controls, consequential actions and unobserved whole-site workflows are not established by this POC. Optional on-device interpretation is contract-tested with mocks; real model accuracy was not evaluated. Full three-site beta coverage and distribution are outside this milestone.

Stop ends observers, timers and the overlay. Pause suspends observation. Forget/Clear stop the session before deleting knowledge. Disabling the extension stops future injection; refresh an already-open website to remove its previous injected content. Site-memory deletion is independent of uninstalling the extension.
