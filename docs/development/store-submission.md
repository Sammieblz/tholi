# Browser-store submission

Use the [release procedure](releasing.md) to certify the final build before
packaging. The existing extension packager creates separate Chromium and Firefox
ZIPs, verifies every archived file against the evaluated build, and writes SHA256
and evidence records under `output/releases`. Do not rename a Chromium archive as
a Firefox build, rebuild after certification, or change a packaged manifest.

## Uploads

- Chrome Web Store: upload `tholi-VERSION.zip` in the
  [developer dashboard](https://chrome.google.com/webstore/devconsole/).
- Firefox AMO: upload `tholi-firefox-VERSION.zip` in the
  [Developer Hub](https://addons.mozilla.org/developers/). Submit the matching
  source archive and build instructions as well. An unsigned ZIP is a submission
  candidate; renaming it to `.xpi` does not sign it.
- GitHub: attach both ZIPs, their SHA256/evidence records, and the source archive
  to the release for the exact source revision. State the validation result and
  remaining manual checks. Store approval and signing are separate outcomes.

The manifests retain Chromium 140+ and Firefox 153+, the existing Firefox ID
`tholi@ilunonsen.com`, and the existing host grants. Firefox declares no required
data transmission and optional backend data categories; connecting a backend
requests native consent. Declining or revoking it leaves local processing
available. See [privacy](../architecture/privacy.md).

## Listing draft

Name: **Tholi**

Summary: **Your next step, made clear. Local website guidance while you stay in control.**

Description:

> Tell Tholi where you want to go on a website. It uses the current page to guide
> your next step and checks the resulting state before recording progress.
>
> Language understanding and visual assistance run locally with bundled models.
> Website access is requested explicitly. Guide mode leaves actions with you;
> optional assisted navigation can open eligible menus and select requested view
> options. You handle credentials, forms and final actions.
>
> Learned website knowledge stays in your browser. Advanced users can explicitly
> connect their own private backend; no backend or cloud account is required.
> You can pause or stop guidance and forget learned website knowledge.

Support: [repository issues](https://github.com/Sammieblz/tholi/issues).
Contact: `info@ilunonsen.com`. License: MIT.

Use a publicly accessible privacy notice matching the actual extension behavior;
the [repository privacy reference](../architecture/privacy.md) documents the
current implementation. Review the existing website privacy draft before using
it as a store policy. Do not claim that optional backend transmission is absent.
Use the bundled 128-pixel icon and truthful product screenshots. Historical
0.10.1 captures retain their original provenance; do not label them as new-version
validation. No store account, payment, listing, signing or approval is implied by
creating an archive.

## Permission explanations

| Permission                        | Purpose                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------- |
| `activeTab`, `tabs`               | Identify the active website and authorized guidance/capture context.              |
| `scripting`                       | Inject observation and guidance into permitted website tabs.                      |
| `storage`                         | Keep local preferences and trusted session state.                                 |
| `webNavigation`                   | Follow native frame/document identities and authorized task transitions.          |
| Chromium `sidePanel`, `offscreen` | Present guidance and host bundled local inference.                                |
| Optional HTTP/HTTPS host access   | Guide the website explicitly authorized by the user, or connect a chosen backend. |

Permanent hosts remain localhost, loopback and English Wikipedia. Explain these
existing grants accurately in the dashboard; do not broaden them for submission.
No remote executable code or model API is required for normal guidance. Models,
OCR workers and WASM are bundled; build-time downloads are hash-verified.

## Firefox reviewer build instructions

Build environment: Windows x64, Node **24.19.0**, npm **11.17.0**. These differ
from Mozilla's default reviewer environment. Use the submitted source revision
and its lockfile, with network access for npm dependencies and pinned asset
downloads. Install Node from [nodejs.org](https://nodejs.org/).

```powershell
npm ci
npm run check:version
node scripts/build-extension.mjs --target=firefox
```

The result is `dist/extension-firefox`. Do not enable experimental Paddle assets.
The build uses esbuild, Sharp and the pinned dependency lockfile; MiniLM and OCR
downloads are checked against `assets/model-lock.json` and `assets/ocr-lock.json`.
The full source archive includes the build scripts, configuration, extension,
shared packages, original media, licenses and lockfile. It excludes credentials,
installed dependencies, local databases and generated output. Compare its build
files with the candidate's per-file hashes in `tholi-firefox-VERSION.json`.

The bundled code requires a source submission because it is bundled/minified.
Provide [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md), the lockfile and the
packaged dependency notices. Retain Mozilla validator output with the release
evidence. Bundled-library warnings and flagged DOM assignments need explanation
and reviewer inspection; a validator result is not store approval.

Sources: [Chrome submission](https://developer.chrome.com/docs/webstore/publish),
[Firefox submission](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/),
[Firefox source requirements](https://extensionworkshop.com/documentation/publish/source-code-submission/),
[Firefox data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).
