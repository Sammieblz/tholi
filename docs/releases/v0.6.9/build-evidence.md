# Historical build evidence, October 2026

Historical observations only. They do not certify current bytes.

# Archived build verification — October 11, 2026

This file preserves historical build evidence. Current setup is in the
[README](../../../README.md); current cleanup status is in [maintenance](../records/2026-10-maintenance.md).
The [v0.9.1 validation](../v0.9.1/validation.md) records pre-cleanup archived bytes.

Production extension candidate: **0.6.9**. Source baseline: `1b9d7f06a7fd2caf19ed1bdc933db3a72fb94e3d`. These fixes are local, uncommitted and unpublished.

| Check                                  | Result                      |
| -------------------------------------- | --------------------------- |
| TypeScript and both production builds  | Passed                      |
| Unit tests                             | 117/117 passed              |
| Complete extension browser regressions | 86/86 passed                |
| Complete live Wikipedia regressions    | 16/16 passed                |
| Unchanged accuracy matrix              | 14 tests / 116 cases passed |
| Exact build/archive comparison         | All ten files match         |

Login/account goals now retain workflow context without requiring a destination value. Generic task wording recognizes login/log in/sign in and create account/register/sign up, with qualifiers preserved. Declared entry links/menus remain distinct from credential submission. Form-local evidence identifies safe fields without borrowing a page heading for unrelated appearance/search forms. Focus advances navigation evidence but never proves authentication success. Stored plain auth journeys upgrade during restoration. Unknown/unusable routes show an unavailable estimate and a reason beside the journey.

Live Wikipedia reproductions revealed that account links redirect from the article origin to a separate authentication origin. The new required **webNavigation** permission associates a recent selected authentication link with a browser-confirmed server redirect in the pinned tab or linked popup. It retains only origins and URL hashes; raw redirect queries are never stored. The actual destination requires its own host grant and exact final URL validation before coach observation. Typed, unrelated and client-script navigation cannot supply this redirect evidence. See [task routing](../../guides/journeys.md), [privacy](../../architecture/privacy.md) and [security](../../architecture/security.md).

Four new live regressions independently follow the actual entry links and inspect the real authentication form at both widths. They verify the same retained journey and a usable Continue button at the ungranted host. A test-only collector validates the live form's username target; this is **not** evidence that the extension has observed that host after a native grant. Browser fixtures verify actual coach continuation across menus, documents, popup tabs and a real HTTP server redirect, then safe-field focus and submission review. No credentials are submitted or accounts created. Native host-permission grant/denial/retry and actual live coach activation beyond the grant remain pending.

Matrix evaluated: `2026-10-11T21:39:17.574Z`. Its unchanged declaration SHA256 is `bb66d75a1671c3f34abfb16430c87c26fe932cf293f36efdbefd2d161e97f7ae`. Live: **60/60 supported outcomes, 71/71 targets and 71/71 verification**. Generic: **30 cases, 24/24 targets, 18/18 verification and 12/12 positives**, with twelve intentional unresolved decisions. Authored: **26/26 conformance**, eight expected stops. All measured suites report zero false success, Navigator automation, known sentinel leakage and model calls. These are declared semantic-mode results, not whole-site or actual-model accuracy.

Browser report: `2026-10-11T21:26:10.084Z`. Live report: `2026-10-11T21:33:00.117Z`. All three reports match the same ten production files. Verified package: `output/releases/internet-navigator-0.6.9.zip` (**706,157 bytes**), SHA256 **f17989358e15c7b313dbff5499f981e2cbbd7a6885bba80b6bef5da0a9cbfe85**, packaged `2026-10-11T21:39:52.688Z`. Earlier archives and reports remain intact.

[Iteration notes](../../../output/acceptance/auth-context-iteration-notes.json) record the popup predicate, redirected-origin discovery, form-context correction and real-server fixture correction. The first complete live run passed 15/16; the existing narrow geometry case had no selected control at its first guide call. Its targeted rerun and a fresh full 16/16 run passed with unchanged assertions/timeouts; the precise transient cause remains unestablished. The failed full report and trace are retained. The earlier isolated long-duration timeout is also disclosed.

Reload **dist/extension** at `chrome://extensions`, confirm version **0.6.9**, and refresh the website. Enter **create account** or **How to log in** once, follow the entry, then use **Continue task here** and grant the actual destination host. Private credentials and final submission stay a review boundary. Native keyboard/screen-reader/permission checks and actual on-device model quality remain unevaluated; #10/#17/#18 stay open.
