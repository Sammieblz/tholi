# Website releases

Website delivery has an independent `MAJOR.MINOR.PATCH` identifier in
`apps/web/release.json`. It does not change the synchronized extension/API product
version or relabel old captures and downloads. Website tags use `web-vVERSION`;
product tags continue to use `vVERSION` under [the product procedure](releasing.md).

## Prepare and validate

1. Add `docs/releases/website/vVERSION/README.md` with first line
   `# Tholi website VERSION`, changes, boundaries and actual validation status.
2. For later releases, run `npm run release:website -- VERSION`. The number must
   increase and notes must already exist. `npm run check:website` verifies them.
3. Run focused website checks and the deterministic PR gate. Merge the reviewed
   branch into the repository's default branch. Git writes may need the owner's
   Git client in a workspace that restricts Git metadata.
4. In GitHub Actions, run **Full validation** on that default branch with
   **Publish the website release after certification** enabled. Leave extension
   candidate packaging disabled unless separately needed. Run the entire
   workflow again after a failed attempt; do not combine attempts.

## Publication

The website publication job requires the default branch and the successful
build, test and certification jobs. It downloads their immutable artifacts and
checks the full evidence again. `npm run package:website` uses the existing ZIP
writer and per-file verification; it never rebuilds or overwrites release files.
The resulting ZIP, JSON provenance and SHA256 record are attached to a GitHub
release for the exact tested commit. Publication is idempotent: an existing tag
or release makes the job stop rather than replace assets. Website releases do
not change which product release GitHub considers latest.

This workflow does not merge branches, submit browser-store packages or deploy
Cloudflare. Accounts and store buttons are explicitly previews in 0.1.0.
Before deployment, finalize the public origin and hosting disclosures. Check
Cloudflare's [asset-size limits](https://developers.cloudflare.com/pages/platform/limits/#file-size):
Pages allows 25 MiB per asset, while existing extension ZIPs are about 29 MB each.
Use suitable download hosting and matching links before uploading the static site.
Keep target-specific checksums and versions intact.
