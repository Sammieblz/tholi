# Workflow capability matrix

Current coverage; the original filename is retained for existing links. Automated
fixtures are distinct from real-site verification. No signed-in workflow below
is certified by a corpus or fixture pass.

Navigator discovers controls from the current interface. A documented guide is a
sequence of purposes, not an automation script. Future steps remain predictions;
each highlight needs a fresh, visible, enabled DOM binding. Users perform clicks,
typing and final submissions; Navigator may scroll a fresh target into view.
General discovery works on HTTP/HTTPS
desktop sites with a per-origin Chrome grant; untested requests can still need
clarification or manual exploration.

| Platform   | Included guide / shared behavior                                                            | Automated verification                                                                               | Signed-in verification                                                                        |
| ---------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Cloudflare | Pages Git integration and Direct Upload, configuration, manual review, deployment status    | NLP target corpus; both simulated complete journeys; authorization context; wrong/busy outcomes      | Pending: account variants, GitHub authorization, actual deployments                           |
| GitHub     | Repository settings, named default branch, new repository, Cloudflare authorization handoff | NLP target corpus; branch/return journey fixtures, namespace checks and API parity                   | Pending: repository permissions, settings-to-creation, actual branch change and authorization |
| Jira Cloud | Project discovery, work-item search and creation                                            | NLP target corpus; creation journey, manual details and requested-item evidence                      | Pending: tenant-specific required fields, project permissions, actual created item            |
| YouTube    | Video search, captions language, playback speed                                             | NLP target corpus; preference journeys; browser fixture with portalled caption menus                 | Pending: native player, available captions, account/experiment variants                       |
| Netflix    | Title search, change plan, cancel membership                                                | NLP target corpus; cancellation and review verification; plan review stages                          | Pending: account, country, billing-provider and retention-flow variants                       |
| Amazon.com | Product search, filter/sort, branching Prime cancellation                                   | NLP target corpus; simulated login, delayed 2FA, hover navigation, retention and Prime status checks | Pending: account, country, third-party billing and actual Prime cancellation                  |

The 360-case corpus tests interpretation and the **first grounded route target**
on independently authored initial-screen fixtures, not all real account journeys.
Each platform has 20 calibration cases and 40 held-out cases. Runtime tests cover
complete simulated journeys and failure boundaries. Chromium tests exercise DOM
discovery, overlays, dynamic menus, frames and performance. Real bundled MiniLM
inference is tested separately in Node and the production extension. Simulated
fixtures and public-page checks do not count as signed-in workflow passes.

Cloudflare guide provenance is the official [Git integration documentation](https://developers.cloudflare.com/pages/get-started/git-integration/)
and [Direct Upload documentation](https://developers.cloudflare.com/pages/get-started/direct-upload/).
Other sources and fetched-content SHA-256 values are in
`packages/navigation-core/guides.ts`. The current Prime guide uses Amazon's
official Prime-cancellation article and semantic predicates. Amazon.com account
and country variants still require fresh live evidence and signed-in checks.

For signed-in checks, open the intended platform and task, grant only its origin,
and follow Navigator's highlights. Record the actual control label, verified
milestone, expected outcome and any mismatch. For Pages, test GitHub authorization
and Direct Upload separately. Only perform deployment, creation, plan-change or
cancellation when you intend that action. Website interactions are observed
automatically; a click never establishes success. Do not save authenticated screenshots
or traces by default.

Limits: English desktop Chrome interfaces, Jira Cloud tenant hosts and Amazon.com.
Closed shadow roots, native file pickers and ungranted frames cannot be inspected
by DOM discovery. File selection is a manual handoff. Virtualized/unmounted
items and omitted projection content remain explicitly incomplete coverage.
Tesseract provides text-only viewport assistance, including some canvas text.
Editable fields and all iframe pixels are masked. Icon-only interfaces and unseen
screens remain limitations. Paddle is available only in an experimental build
and has not passed promotion gates. Hosted inference, custom training and a
required LLM remain deferred. See [native checks](../../guides/getting-started.md).
