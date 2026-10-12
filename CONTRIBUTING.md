Use Node **24.19.x** and npm from that release. Start with:

```sh
npm ci
npm run fetch:model
npm run check
npm run build:api
npm run test:nlp
npx playwright install chromium
npm run test:nlp:browser
npm run test:e2e
npm run test:live:wikipedia
npm run test:acceptance
```

Load `dist/extension` at `chrome://extensions` with Developer mode. Click the
extension action on the website before starting. Native side-panel behavior,
permission prompts and screen-reader checks are separate from Playwright.

`packages/navigation-core` owns validated requests, task queues, hybrid
planning and storage ports. `packages/nlp` owns Compromise interpretation,
BM25, semantic indexing and CPU MiniLM. `apps/extension` owns DOM discovery,
binding, verification, permissions and IndexedDB. `apps/api` is an optional
single-owner HTTP/SQLite adapter using the same core in a worker thread.

Never add a website-specific selector or navigation script to the product.
Keep independent website selectors in test oracles. Never scrape editable
values, credentials or complete page HTML into knowledge or embeddings.
Similarity cannot complete a task or bypass a consequential boundary.

The frozen corpus is `tests/nlp/corpus.json`, checked by `corpus.sha256`.
Tune only against calibration examples. Report held-out metrics separately.
Changes to the corpus require an explicit version and annotation review;
do not regenerate expectations from predictions or lower release thresholds.

Release tests recursively hash every packaged asset. Package without rebuilding
after evaluation. Existing release ZIPs are immutable. See
`docs/nlp-architecture.md` and `docs/chrome-handoff.md` for runtime limitations.
