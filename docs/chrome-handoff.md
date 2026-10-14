# Chrome setup and native verification

Build with `npm ci` and `npm run build:extension` using Node 24.19.x. Open `chrome://extensions`, enable Developer mode, and load `dist/extension` unpacked. After each build, select Reload for **Tholi** and refresh existing website tabs to replace injected scripts. Confirm version **0.10.1** in Chrome's extension details.

On an ordinary HTTP/HTTPS website, click the toolbar icon, enter a destination and select **Guide me**. Approve only the site you intend to navigate. The backend is optional. Under **Tholi settings**, enable **Advanced controls** to access **Explore page controls**, diagnostics, and backend options. Authored Northstar tasks retain their separate Start button.

Switch between Guide and Conversation during the same task. Try Pause, Resume, Stop, and “Why this step?” in Conversation. Use **Tholi settings → Use floating widget** to check dragging, resizing, Layout position/size buttons, keyboard controls, Expand, and **Use sidebar**. Confirm the destination survives each view/surface change and a website reload. Compact widgets must keep readable instructions and Pause/Stop available. Check four idle reminders, their cancellation, reduced motion, and absence of arrival feedback until the requested result is verified.

## Access recovery

DOM discovery and screenshot access are separate. A saved site grant can permit scanning while Chrome still requires renewed toolbar activation for viewport capture. If Navigator requests activation, click its toolbar icon on the intended active tab; the destination should remain retained.

Expected document/authentication handoffs resume when access is available. A new origin may require **Continue task here** and its specific host grant. Declining access retains the objective for retry. Unrelated navigation pauses the journey; resuming requires a fresh observation. Restricted Chrome pages cannot be scanned.

## Pending native checks

Record Chrome version, manifest version, build provenance, date and result. Automated extension-page tests do not establish native permission dialogs, side-panel behavior or actual screen-reader speech.

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

Release archives and provenance live under `output/releases`. Use the archive's adjacent report for its tested-byte claims; the current working tree may differ. See [maintenance](maintenance.md) and [historical validation](v0.9.1-validation.md).
