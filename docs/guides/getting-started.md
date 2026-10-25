# Getting started

Tholi is available on the Chrome Web Store and Firefox Add-ons. Visit
[Get Tholi](https://tholi.io/download), choose **Add to Chrome** or **Add to
Firefox**, review the listing and permissions, then confirm installation in your
browser. Opening the listing does not install the extension. Use desktop Chrome
(Chromium **140 or newer**) or Firefox **153 or newer**.

No Tholi account is required. Normal guidance processes data locally. Connecting
your own private backend is optional; the extension explains the data sent before
you enable that connection.

1. Open your browser's **Extensions** menu, find Tholi and pin it to the toolbar
   for easy access.
2. Visit the website you want help with and select the Tholi toolbar icon. Grant
   access to that website when asked. Restricted browser pages cannot be guided.
3. Enter a destination and choose **Guide me**. Follow the instruction and page
   highlight. You make the clicks and handle website sign-in and consequential
   actions. A click alone does not establish arrival.

You can try the [optional account-free practice](https://tholi.io/onboarding)
before installing. Website practice uses an isolated sample and cannot confirm
installation or change your extension's state.

## Developer installation

For verified ZIPs and manual build directions, expand **Developer installation**
on the [download page](https://tholi.io/download#developer-installation).

Use Windows and Node 24.19.x. Run `npm ci` and `npm run build:extension`. The normal build produces both targets with the same pinned local model, single-thread WASM and safety boundaries. Focus a target with `npm run build:extension -- --target=chromium` or `--target=firefox`.

### Chromium: Chrome, Edge and Brave

Use Chromium **140 or newer**. Open `chrome://extensions`, `edge://extensions` or `brave://extensions`. Enable **Developer mode**, select **Load unpacked**, and choose `dist/extension`. Reload Tholi after rebuilding, then refresh existing website tabs. Other current Chromium browsers are compatible only when the required native document, scripting, storage and surface capabilities pass; that is not explicit branded verification.

### Firefox development build

Use Firefox **153 or newer**, rather than an older ESR. Open `about:debugging`, select **This Firefox → Load Temporary Add-on**, and choose `dist/extension-firefox/manifest.json`. The add-on ID is `tholi@ilunonsen.com`. This unsigned development build is removed when Firefox restarts; load it again for the next development session. Reload after a build and refresh website tabs. The published store version uses normal store installation instead.

The website's `/download?browser=firefox#installation-firefox` link opens the developer instructions for Firefox. Verified developer ZIPs, versions and checksums appear there when an eligible archive is available. A Chromium archive is never offered as a Firefox artifact. When an eligible target archive is unavailable, use source setup. Existing product footage was captured in Chrome.

## Using your guide

On an ordinary HTTP/HTTPS website, click the toolbar icon, enter a destination and select **Guide me**. Approve only the site you intend to navigate. The backend is optional. Under **Tholi settings**, enable **Advanced controls** to access **Explore page controls**, diagnostics, and backend options. Authored Northstar tasks retain their separate Start button.

Switch between Guide and Conversation during the same task. Try Pause, Resume, Stop, and “Why this step?” in Conversation. Use **Tholi settings → Use floating widget** to check dragging, resizing, **Widget menu** position/size controls, keyboard controls, **Expand widget**, and **Dock to sidebar**. Confirm the destination survives each view/surface change and a website reload. Compact and minimal widgets prioritize one readable message and the composer, with Pause/Resume/Stop in Widget menu. Check four idle reminders, their cancellation, reduced motion, and absence of arrival feedback until the requested result is verified.

## Widget continuity checks

Close the widget with X and confirm it becomes a 44-pixel launcher. The task should continue observing without expanded highlights or automatic guidance scrolling. Reveal a relevant menu on the website, then restore Tholi: the same destination, draft and conversation should remain, with fresh guidance. Repeat through a recognized document transition and worker restart. Reset current session should clear unfinished tasks and conversation while preserving learned knowledge and saved routes.

During a deliberate drag, approach within 24 pixels of the right viewport edge and release on the docking preview. Chromium should open its configured native panel side before the widget disappears. If the browser rejects activation, the widget must remain and explain toolbar/Dock recovery. Test native panel close/reopen only on versions exposing the lifecycle events. Firefox restricts privileged APIs inside website-embedded extension iframes. Its explicit Dock action retains the widget and asks you to click **Tholi in the browser toolbar**. That native user action opens the sidebar before removing the widget. The same session retains destination, draft and conversation. Embedded-origin permissions also use the privileged sidebar. See [browser validation](../releases/v0.10.1/browser-support.md) for measured and pending checks.

## Access recovery

DOM discovery and screenshot access are separate. A saved site grant can permit scanning while the browser still requires renewed toolbar activation for viewport capture. If Tholi requests activation, click its toolbar icon on the intended active tab; the destination should remain retained.

Expected document/authentication handoffs resume when access is available. A new origin may require **Continue task here** and its specific host grant. Declining access retains the objective for retry. Unrelated navigation pauses the journey; resuming requires a fresh observation. Restricted browser pages cannot be scanned.

While **Explore page controls** is active, an ungranted embedded origin exposes an **Allow ORIGIN** action even before a destination is entered. This page-access notice is separate from task-owned instructions. The action requests only that origin; declining leaves its controls unscanned. Paused, stopped and completed sessions do not revive old permission prompts.

## Pending native checks

Record browser name/version, manifest version, build provenance, date and result. Automated extension-page tests do not establish native permission dialogs, native sidebar behavior or actual screen-reader speech.

| Check                                                                           | Status  |
| ------------------------------------------------------------------------------- | ------- |
| Toolbar opening, reload and tab refresh                                         | Pending |
| Per-site grant, denial, retry and restricted-page explanation                   | Pending |
| Screenshot activation and recovery after origin changes                         | Pending |
| Keyboard goal submission, Pause/Resume/Stop, expandable details and focus       | Pending |
| Screen reader: meaningful status changes without repeated polling announcements | Pending |
| Narrow panel and 80%, 125%, 200% browser zoom                                   | Pending |
| Related popup/authentication handoff and unrelated navigation                   | Pending |
| Restart, saved-route reuse, Forget/Clear and observer teardown                  | Pending |

## Real-site checks

On Amazon.com, enter **Help me cancel my Amazon Prime membership** once. Follow website highlights through login, delayed 2FA, account navigation, Prime management, retention offers and review. The user enters credentials and performs any intended final cancellation. Neither a click nor an unrelated success message may complete the task; fresh Prime membership status must confirm the requested outcome. Already-canceled and unavailable memberships require their own state evidence.

On Wikipedia, try text size, dark mode, width, references, privacy policy, search and language changes. Check the actual bound control and destination, including scrolling and clipped menus. Missing sections must receive no invented substitute. **Show search** can finish at a focused field; **Search for Saturn** requires its requested result. Opening a language picker is intermediate progress.

Signed-in Amazon, Cloudflare deployment and GitHub settings-to-repository journeys remain pending user-assisted verification. Do not record credentials, authenticated screenshots or private traces by default. Do not perform a subscription cancellation, deployment or publication merely to satisfy a test.

Release archives and provenance live under `output/releases`. Use the archive's adjacent report for its tested-byte claims; the current working tree may differ. See [maintenance](../releases/records/2026-10-maintenance.md) and [historical validation](../releases/v0.9.1/validation.md).
