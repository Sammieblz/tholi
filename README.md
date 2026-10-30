<p align="center">
  <img src="apps/public/media/tholi_brand_logo.png" width="240" alt="Tholi" />
</p>

<h1 align="center">Find your way forward.</h1>

<p align="center">Tell Tholi where you want to go. Follow a clear next step, right on the website.<br />You make the clicks. Tholi keeps the destination in view and checks the result.</p>

<p align="center">
  <a href="#try-tholi">Try Tholi</a> ·
  <a href="docs/README.md">Documentation</a> ·
  <a href="CONTRIBUTING.md">Contribute</a> ·
  <a href="docs/architecture/privacy.md">Privacy</a>
</p>

<p align="center"><strong>Desktop Chromium & Firefox · English · Local processing · No account required</strong></p>

![The real Tholi widget guides a text-size change on Wikipedia, highlighting the Large control beside its instruction.](apps/public/media/screenshots/live-guidance.webp)

_Actual Chrome extension capture on public [Wikipedia](https://en.wikipedia.org/wiki/Ada_Lovelace), October 15, 2026. [Capture details and provenance](docs/development/media-capture.md). This example does not establish reliability on every website._

## A guide that stays with you

- **One destination, continuous guidance.** Keep your request through supported page changes, menus, login and two-factor verification.
- **Your interface, your choice.** Use the sidebar or a movable, resizable widget. Guide keeps the next action prominent; Conversation keeps the request and its context together.
- **You stay in control.** Tholi highlights freshly observed controls and can scroll them into view. You click, type, authenticate and submit. Arrival requires outcome evidence.
- **Local by default.** The packaged English language model and Tesseract OCR run on your CPU. No cloud model or backend is required.

<p align="center">
  <img src="apps/public/media/screenshots/guide-panel.webp" width="240" alt="The actual Tholi Guide interface with one current instruction and an anchored destination composer." />
  <img src="apps/public/media/screenshots/conversation-panel.webp" width="240" alt="The actual Tholi Conversation interface explaining the current step from available route evidence." />
</p>

## Try Tholi

Install Tholi from the Chrome Web Store or Firefox Add-ons using
**[Get Tholi](https://tholi.io/download)**. No Tholi account is required. Open the
Extensions menu, pin Tholi, then open it on a website and grant access when asked.
You choose the destination and make the clicks.

### Developer installation

Use **Node 24.19.x** and npm. From the repository root:

```sh
npm ci
npm run build:extension
```

The build fetches and verifies pinned MiniLM and English Tesseract assets. These are bundled into the extension; installed inference needs no runtime model download.

1. In Chrome, Edge or Brave, open `chrome://extensions`, `edge://extensions` or `brave://extensions` and turn on **Developer mode**.
2. Choose **Load unpacked** and select `dist/extension`.
3. Open a website, click the **Tholi** toolbar icon and allow website access if your browser asks.
4. Enter a destination, such as **Make the text larger** on Wikipedia, then select **Guide me**.

For **Firefox 153+**, open `about:debugging`, select **This Firefox → Load Temporary Add-on**, and choose `dist/extension-firefox/manifest.json`. This unsigned **Firefox developer preview** is removed on browser restart. Chromium requires engine version **140+**. Both targets bundle the same local model and safety checks. Other Chromium browsers are capability-compatible; [branded verification and measurements](docs/releases/v0.10.1/browser-support.md) are recorded separately.

After rebuilding, reload the matching target in its extension manager and refresh the website tab. [Browser setup and permission recovery](docs/guides/getting-started.md) covers the details.

Guide mode leaves clicks with you by default. **Settings → Assisted navigation**
can open eligible menus and select explicitly requested view options. It stays off
until enabled; credentials, forms and final actions remain yours. See the
[controls and limits](docs/guides/using-tholi.md#optional-assisted-navigation).

### Explore the website

**[tholi.io](https://tholi.io) is live on Cloudflare Pages.** Website 0.1.0 is
[published on GitHub](https://github.com/Sammieblz/tholi/releases/tag/web-v0.1.0)
and merged into `main`. See the [website release record](docs/releases/website/v0.1.0/README.md)
for deployment and validation status. To run it locally:

```sh
npm run dev:web
```

Open **http://127.0.0.1:5174** for the real extension recording, interactive practice, searchable docs and store installation. Website 0.1.1 is prepared in the [published-store launch record](docs/releases/website/v0.1.1/README.md); mock account routes are retired. Developer downloads and source instructions are secondary. Dark is the default; optional preference cookies can remember Light/Dark. The app's own analytics provider is inactive; the public Cloudflare deployment injects its own measurement script, independently of these cookie choices. See the [cookie notice](https://tholi.io/cookies) and [deployment record](docs/releases/website/v0.1.0/validation.md).

**Extension/API version: 0.11.0, published on both stores.** [Release notes](docs/releases/v0.11.0/README.md) · [Changelog](CHANGELOG.md). The website offers developer ZIPs only when an eligible, verified archive is available; otherwise its developer area shows source setup. Download version and checksum come from that archive, independently of the source version. Store links remain available without developer archives. No Tholi account is required.

## Current limitations

Complex dashboards, unseen screens, inaccessible icon or canvas controls, closed shadow roots and native dialogs can still interrupt a route. An unclear route remains incomplete. OCR suggestions never establish completion. Native permission/accessibility checks and signed-in Amazon, Cloudflare and GitHub verification remain [pending](docs/guides/getting-started.md).

The default local pipeline combines Compromise, lexical retrieval and MiniLM. Optional backend and browser-provided model integrations are separate, opt-in features. **PaddleOCR remains experimental and is excluded from normal builds.** Its [evaluation and fallback status](docs/releases/records/2026-10-maintenance.md) must not be confused with default-engine support.

## Build and contribute

| Work                                | Command                                   | Output                                             |
| ----------------------------------- | ----------------------------------------- | -------------------------------------------------- |
| Chromium and Firefox extensions     | `npm run build:extension`                 | `dist/extension`, `dist/extension-firefox`         |
| Product website                     | `npm run dev:web` / `npm run build:web`   | Port 5174 / `dist/web`                             |
| Controlled Northstar test workspace | `npm run dev:demo`                        | Port 5173                                          |
| Optional local API                  | `npm run build:api` / `npm run start:api` | [API setup](docs/guides/backend.md)                |
| Cloud-free backend infrastructure   | `npm run local:init` / `npm run local:up` | [Container setup](docs/development/local-stack.md) |
| Deterministic PR validation         | `npm run test:ci`                         | Local validation                                   |

Install the test browsers once with `npx playwright install chromium firefox`. The [release procedure](docs/development/releasing.md) covers versioning and certification. The [contribution guide](CONTRIBUTING.md) lists focused checks, frozen corpora and exact-byte release gates. Packaging never substitutes historical test reports for the current build.

`npm run test:ci` runs deterministic PR checks. `npm run test:full` runs complete certification before gated packaging. Existing focused aliases remain available. See [testing and CI](docs/development/testing/README.md), [coverage ledger](docs/releases/v0.10.1/coverage-ledger.md) and [architecture](docs/architecture/README.md). Public-site tests, frozen model/OCR budgets and the complete responsive matrix run nightly, manually and before releases.

The extension worker owns journeys and verification; `packages/ui` owns shared presentation; the website practice uses an isolated, controlled adapter. Start with [frontend ownership](docs/architecture/frontend/README.md), [navigation architecture](docs/architecture/navigation.md), [NLP](docs/architecture/natural-language.md), and [the documentation index](docs/README.md).

Reusable site knowledge stays local. Private values and task context remain session-only; screenshots and field values are not stored as route knowledge. [Privacy](docs/architecture/privacy.md) and [security](docs/architecture/security.md) describe the optional backend and deletion controls.

<p>
  <img src="apps/public/media/tholi_icon.png" width="32" alt="Tholi icon" />
</p>

Tholi is operated by **[ILUNỌNSEN LLC](https://ilunonsen.com)**, Ohio, United States. [Contact](mailto:info@ilunonsen.com).

[MIT license](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md) · [Naming and compatibility](docs/development/naming.md)
