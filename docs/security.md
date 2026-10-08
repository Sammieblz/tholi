# Prototype trust model

Page content is untrusted data. Route packs are bundled declarative schemas; no remote executable routes or JavaScript instructions. The route engine emits typed transitions and cannot click. Extension commands require a matching extension ID and an extension-owned sender URL. Content updates require the assigned tab, supported sender origin and validated session schema. Every engine update checks route origin.

The manifest uses activeTab, scripting, sidePanel and storage, plus explicit development host access to http://127.0.0.1/* and http://localhost/*. Chrome host patterns cover all ports on those hosts; the route's exact-origin gate limits navigation to port 5173. There are no all-sites, tabs or cookie permissions. Opening the panel does not inject a content script or start observation. The Chromium harness now uses the production manifest unchanged.

Final cancellation is a terminal hard stop. Optional confirmation after manual action requires explicitly starting a fresh session on the success screen. Unexpected screens and tied targets stop. During an expected transition, transient unknown DOM is given the declared timeout; no guidance is shown while waiting.

Remaining review: production Chrome toolbar/side-panel interaction, service-worker lifecycle under extended use, malicious routes/pages, accessibility and live-site fixtures.
