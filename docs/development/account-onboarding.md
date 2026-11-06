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

`packages/ui/onboarding.tsx` owns the shared explanation and illustrations only.
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
skippable progress, native controls, descriptive labels, visible focus, 44px targets,
existing brand typography and tokens, and meaningful state feedback. Graphics are
explicit illustrations. A highlighted control or animation does not prove arrival.

Illustration entrances use transform/opacity, a 220ms entry and a bounded 2.4s
explanation. They do not loop or auto-advance. Hidden surfaces stop motion;
reduced-motion and keyboard navigation show immediate static states. Existing
homepage GSAP motion remains separate. No animation dependency was added.

Validation evidence is recorded in [the feature validation record](testing/account-onboarding-validation.md).
Native store installation and screen-reader checks remain pending until performed.

## Product showcase

The shared `IntroductionPreview` also appears on the initial extension welcome
screen. It illustrates a natural-language request in Conversation, a grounded
next step in Guide, and separate Local/account choices. The Sidebar preview and
Floating widget preview buttons change presentation only. They never control a
website, select an extension surface or establish task progress.

Pointer chapter changes return to the introduction so the new scene can be seen.
Keyboard changes focus the heading immediately with motion suppressed. Examples
come from the public help guides, and no illustrated click claims arrival.
Pressed preview choices use a gold underline and a native pressed state, with no
filled selection pill. Existing fonts, tokens and Wayfinder artwork are reused.

Fresh refinement evidence is in [the showcase validation record](testing/account-onboarding-showcase-validation.md).
