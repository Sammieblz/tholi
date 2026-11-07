# Account entry and first-run setup

This feature prepares website and extension account entry for local development.
It does not enable production hosting, paid plans, managed Gemini, transmission
consent or automatic local-data uploads. Website 0.1.1 and extension/API 0.11.0
remain unchanged. Store users need a separately authorized, certified release.

## User paths

The website keeps Sign in visible beside store installation. Sign up opens three
short chapters under `/signup?step=1`, `2` or `3`. Back, refresh and direct links
retain the chapter. Skip introduction and Create your account open the existing
identity-provider registration flow. Signed-in account entry replaces history
with `/account`. `/onboarding` stays optional account-free installation/practice.
Unconfigured builds explain account unavailability and retain local installation.

Fresh Chrome and Firefox installs open one packaged `welcome.html` tab. It offers
Sign up, Sign in and Use Tholi locally. Sign-up shares the website's presentation;
sign-in uses native identity directly. Local completion fences pending sign-in
and disables inference/image transmission through the existing account owner,
which also fences automatic navigation learning and retrieval. Authentication
success is established by current native account metadata, never website cookies.

Updates and restarts do not reopen setup. Retained installations without a setup
record keep their normal experience. Closing setup never blocks Local guidance.
Incomplete sidebar setup exposes Finish setup; settings retain Review introduction.
Setup progress is device-local and independent of account logout or deletion.

## Ownership and configuration

`packages/ui/onboarding.tsx` owns the shared explanation and recording selection only.
Hosts supply progress and actions. The existing AccountProvider and service-auth
owners retain website sessions and privileged native credentials respectively.
Marketing pages mount no account/session provider.

The background setup service serializes version-1 progress and completion writes
through protected settings. Typed SETUP_STATUS, SETUP_OPEN, SETUP_STEP and
SETUP_COMPLETE commands are admitted only from the exact sidebar or top-level
packaged welcome page. The welcome role can additionally use AUTH_STATUS,
AUTH_CONFIGURE and AUTH_SIGN_IN. It cannot access saved data, inference controls,
journeys, widgets or content observations. It is not a web-accessible resource.

The existing privileged panel port carries metadata-free account/setup changes.
Settings reread current account state rather than receiving credentials or trusting
the welcome page. The originating native document is excluded only when its real
document identifier matches; missing identifiers conservatively notify the panel.

`VITE_THOLI_SERVICE_ORIGIN` supplies an optional public website/extension service
origin. The extension validates it through the existing service-origin owner and
configures it only during an explicit authentication action. Existing explicit
development service overrides remain supported. No secret belongs in this input.

The portable Keycloak login theme extends provider forms. Local Compose mounts
the generated theme read-only. Realm reconciliation preserves users. Fonts, palette
and logo reuse existing source assets; font licenses accompany generated resources.
Theme JavaScript reads only a provider-local appearance preference, never fields,
authentication parameters, credentials or session data. Production delivery remains
separate from this local theme preparation.

## Design guidance and validation

Applied the repository's ui-ux-pro-max, animate and fixing-accessibility skills:
skippable progress, native buttons and links, descriptive labels, visible focus, 44px targets,
existing brand typography and tokens, and meaningful state feedback. The current introduction uses real extension footage. A highlight alone does not
prove arrival; the capture requires independent DOM and worker outcome checks.

Chapter entrances use transform/opacity for 220ms, without delaying controls.
Onboarding recordings automatically play muted and loop while visible. They have
no playback controls, caption tracks, caption text or transcript links, as
requested. Hidden/offscreen footage pauses; reduced-motion and data-saving
preferences keep a still poster. Playback never advances the introduction. Existing
homepage GSAP motion remains separate. No animation dependency was added.

Foundation evidence is recorded in [the feature validation record](testing/account-onboarding-validation.md).
Native store installation and screen-reader checks remain pending until performed.

## Product showcase

`IntroductionRecording` appears in each shared signup chapter and on the initial
extension welcome screen. Three actual recordings demonstrate entering a request,
Guide/Conversation, Pause/Resume, a verified preference change and finishing setup
with Use Tholi locally. Playback cannot control a website or extension. It never
changes the viewer's preferences, setup progress or account choice.

The existing `RecordedVideo` owner is shared with the homepage, preserving that
recording's deliberate pause, theme change and visibility behavior. Onboarding
uses automatic muted looping without controls or captions. Posters reserve the video's
aspect ratio, and media failure never blocks Next, Back, sign-in or Local choices.
The former simulated interface, scene selectors and illustration keyframes have
been removed.

Pointer chapter changes return to the introduction so the recording can be seen.
Keyboard changes focus the heading immediately with entrance motion suppressed.
The existing typography, tokens, store links and account boundaries are preserved.

### Capture and provenance

Run `npm run build` then `npm run capture:video -- --workflow=onboarding` against a
frozen build. The existing capture owner bundles the existing browser harness for
standalone Node use and opens a disposable Chromium profile. It serves a local
Fieldnotes fixture, blocks external HTTP and uses the bundled local engine. It
warms local discovery before filming and records actual interface timing at
1040 x 800 and 30 fps; the operator changes the
real radio control. DOM selection and text size plus worker/journey verification
are required before completion footage is accepted. A rejected take is not
published. The last clip shows the real packaged welcome page selecting Local;
transmission status must remain disabled.

New media lives in `apps/public/media/onboarding/`, with captions, transcripts,
posters, artifact hashes and capture provenance. Both browser targets copy this
folder into their private packaged welcome assets; it is not web-accessible.
Generated captions and transcripts remain capture evidence only. They are omitted
from the onboarding catalog and are not rendered or linked by the introduction.
The old 0.10.1 Wikipedia recordings and their evidence remain unchanged. Fresh
recordings identify their actual extension build, rather than certifying every
site, operating system or browser permission flow.

Fresh autoplay/player evidence is in [the autoplay validation record](testing/account-onboarding-autoplay-validation.md).
The [earlier controlled-playback evidence](https://github.com/Sammieblz/tholi/blob/96ec168bc778ff736f8da5c5c131210e4b21b9f8/docs/development/testing/account-onboarding-recording-validation.md)
remains scoped to that earlier build.
The [earlier illustrated showcase evidence](testing/account-onboarding-showcase-validation.md)
remains historical and does not certify the replacement media.
