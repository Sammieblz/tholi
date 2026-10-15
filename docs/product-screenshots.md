# Website product screenshots

The home page uses four captures from the running Tholi 0.10.1 extension in a disposable Playwright Chromium profile. They show public Wikipedia, not an authenticated account. Guide and Conversation are captured from the extension page that hosts the sidebar interface; the full-page images show the actual injected widget and highlight.

The request is “Make the text larger.” Capture requires a fresh, grounded plan targeting the live control. After selecting Large, the script requires the engine's completed result and the UI's arrived state. It does not inject a fabricated plan, overlay, message, or success state. The separate interactive sample remains explicitly labeled as a demonstration.

## Regenerate

With Node 24.19.x, dependencies, Playwright Chromium, and the matching built extension available:

```powershell
npm run capture:web
```

This command needs public Wikipedia access. It changes the text-size preference only inside its temporary profile, then removes that profile. It does not use a personal browser or credentials. If the page changes during observation, planning retries against the current revision, up to three attempts. Failure stops capture rather than producing a substitute image.

Optimized WebP files and `provenance.json` live in `apps/public/media/screenshots`. The manifest records the source page, request, extension version, dimensions, SHA-256 hashes, and capture time. Uncompressed PNG sources stay in ignored `output/qa/product-sources`. Keep screenshot captions and the visible version current when regenerating. Wikipedia article and image credits are linked beside the captures.

These captures verify the demonstrated preference change. They do not establish native Chrome permission behavior or reliability on other workflows. The downloadable archive retains its own release version and checksum, independent of the screenshot version.

The image viewer uses Base UI for focus containment, Escape dismissal, and focus return. Images have dimensions, descriptive text, lazy loading below the hero, and full-size viewing. Existing page entrance and section motion apply to the showcase and respect reduced motion.
