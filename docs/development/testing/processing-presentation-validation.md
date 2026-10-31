# Processing choices and recovery verification, October 31, 2026

Scope: [#42](https://github.com/Sammieblz/tholi/issues/42), following the #41
[journey-proposal acceptance evidence](journey-proposals-validation.md). This is
implementation and PR evidence, not release certification. Extension/API `0.11.0`
and website `0.1.1` remain unchanged. Paid models, hosted account plans, actual
balances, checkout and first-run onboarding belong to later milestones.

## Ownership and applied guidance

The existing privileged account settings own saved processing choices. The
current-task notice owner admits request-scoped service state. Shared Guide UI
receives presentation and callbacks; it receives no credentials or browser
privileges. Widget configuration uses the existing sidebar route rather than
another account surface. Pending service work must not disable Pause or Stop.

Applied project-local skills:

- [fixing-accessibility](../../../.codex/skills/fixing-accessibility/SKILL.md):
  native named controls, associated helper/error text, visible keyboard focus,
  persistent recovery explanations and accessible busy/status feedback. Keep
  privacy withdrawal operable during pending work. Automated accessibility-tree
  assertions do not establish actual screen-reader speech.
- [ui-ux-pro-max](../../../.codex/skills/ui-ux-pro-max/SKILL.md): the targeted
  `loading feedback error recovery` UX search returned Error Recovery, Loading
  Indicators and Loading States from `ux-guidelines.csv`. Apply clear next
  actions, stable layout and focus, adequate interaction targets and explanations
  for waits. Reuse existing tokens and components; add no decorative animation,
  new visual system or button arrows.

Local guidance remains account-free. Connected development processing must be
explicit, fake-only and separately consented for context and masked images.
Current service errors may report limits; they cannot establish a real credit
balance or a working paid plan. Model responses and status announcements cannot
establish progress or arrival.

The radio choice commits directly, so it needs no duplicate draft/Save flow.
An operation version rejects stale initial, permission, account and failure-read
responses. A non-rendering acknowledged-choice snapshot is distinct from the
optimistic radio state: an unavailable dispatch/status read cannot manufacture a
confirmed Local choice. Acknowledged browser-off remains separate from failed
server withdrawal or account-metadata refresh. Private backend settings and
consent remain separate from this development service choice.

## Validation status

| Check                                                            | Status                                                                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Current-request mapping and phase precedence                     | Passed: 11 focused presentation checks                                                           |
| Immediate withdrawal and stale operation responses               | Passed: 50 existing lifecycle-owner checks                                                       |
| Shared Guide accessibility and persistent recovery               | Passed: 14 focused shared-UI checks                                                              |
| Installed Chromium and Firefox                                   | Focused Chrome processing and six retained proposal regressions passed; two Firefox cases passed |
| Keyboard, themes, narrow layout and reduced motion               | Focused installed checks and three existing layout owners passed; captured layouts inspected     |
| TypeScript, production build and complete `test:ci`              | Pending                                                                                          |
| Required hosted checks                                           | Required before merge                                                                            |
| Native permission prompts, actual OAuth and screen-reader speech | Not performed for this milestone; remain pending                                                 |

The first fresh-build focused cohort
`c9b1942a-600a-4b44-b705-0a2f792deba5` passed eight of nine Chromium cases, two
native Firefox cases and all three layout owners. Retry revealed an actual
contract bug: its SET_GOAL lacked the required page revision and was rejected
before inference. The consumer now supplies the current retained revision and
native session/document identifiers, refusing incomplete context. The strict
schema and browser oracle remain unchanged. The failed trace is preserved under
that cohort's `test-results/`.

After rebuilding the changed extension and verifying the unchanged remaining
artifacts, all three processing cases passed in
`7f420b7b-99bc-4567-9f70-72f3b7a0503e`. Initial type/build checks, final required
payload acceptance, current-goal recovery, persistent announcements, honest limits
and Local withdrawal are distinct from full PR certification, which remains a
separate gate. Layout evidence covers 300px installed panels in both appearances
and 240x152, 360x392 and 420x590 widget recovery, with focus scrolling and a fully
visible 44px Retry control. It does not certify native sidebar focus from the
separate-tab test fixture.

Use separate `output/qa/processing-42-*` run identities. Preserve failed attempts
and actual browser/build hashes. Earlier #40/#41 evidence does not certify the
new UI. No paid inference, production deployment, packaging or desktop
implementation is authorized by this record.
