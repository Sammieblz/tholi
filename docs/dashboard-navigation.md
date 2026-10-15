# Dashboard settings navigation: 0.9.2

Ordinary destinations such as “Account settings” previously required the final control to be mounted. A relevant account menu could be visible while the planner reported no route. A generic “Settings” label could also lose the distinction between account and repository settings.

The shared planner now offers a grounded exploration step through a freshly observed, named account/profile/user menu. It retains the original destination and checks newly revealed controls. Opening the menu is a verified intermediate interaction, not task completion. Ambiguous menus, exclusions, missing qualifiers and unknown effects still prevent automatic selection. This uses interface semantics rather than vendor URLs or selectors.

Settings scope survives rebinding and document changes. A “Settings” item within user navigation can match account settings; repository or product settings cannot substitute for it. Accessible SVG icon names are included without guessing from icon shapes. The destination field and primary button also regain full-width styling.

Relevant menu exploration can start while embeddings load. A connected backend without the `settings-navigation` capability falls back to local planning for settings requests; the optional backend is not required.

## Verification

- Strict TypeScript checks and 169 unit tests passed.
- The frozen NLP suite passed all 11 tests, including real bundled-model inference and qualifier/safety checks.
- All 17 multi-app tests passed. The existing held-out GitHub default-branch mismatch remains recorded; this change does not resolve that separate workflow.
- Eight focused browser cases passed across desktop and narrow layouts: dashboard navigation plus existing page-context regression tests. Dashboard fixtures cover off-screen account navigation, SVG-named user menus, portalled menus without expanded-state attributes, conflicting repository settings, and final document navigation.

These browser checks use controlled Cloudflare-like and GitHub-like fixtures. Signed-in Cloudflare and GitHub verification remains pending because the user's live browser tabs were unavailable. Full release suites were not rerun and no replacement release archives were produced. This is a rebuilt unpacked extension, not certification of every dashboard workflow.

## Try the rebuilt extension

1. Open `chrome://extensions` and select **Reload** on Tholi.
2. Confirm its version is **0.9.2** and that its unpacked directory is this repository's `dist/extension`.
3. Refresh the website tab, open Navigator, and enter **Account settings** once.

Navigator should guide a relevant menu when the destination is not mounted, then replan against its live contents. The destination stays active until fresh evidence verifies arrival.
