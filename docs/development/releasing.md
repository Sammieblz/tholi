# Versioning and releases

Tholi uses one release number for the root project, extension, optional API and
bundled workspaces. `package.json` owns it. Package names, storage schemas, API
protocol versions, model revisions and consent versions are independent
compatibility identifiers; do not bump them just to match a product release.

Use `MAJOR.MINOR.PATCH`: patch for compatible fixes, minor for new capabilities,
major for breaking product/contracts changes. Before 1.0, explicitly document any
breaking changes in a minor release. Use three numeric components accepted by
both browsers; prerelease labels are described in the notes rather than placed
in the extension version. Preparation is **unreleased** until certification and
publication have actually happened.

## Prepare a version

1. Inspect existing implementation, tests and releases. Pick a new, increasing
   version; do not reuse a released number or rewrite historical evidence.
2. Create `docs/releases/vVERSION/README.md` starting with `# Tholi VERSION`.
   Include changes, compatibility/migration notes, known limits, installation,
   validation status and links to version-specific evidence. Add a validation
   record and a root [changelog](../../CHANGELOG.md) entry.
3. Run `npm run release:version -- VERSION`. It updates the root and workspace
   packages, internal dependency pins, lockfile metadata and common extension
   manifest together, without upgrading external dependencies, committing,
   tagging, rebuilding or packaging.
4. Update current-version prose in README, guides and the naming reference.
   Keep capture provenance, frozen fixtures, older release docs and download
   archive metadata at their genuine original versions.
5. Run `npm run check:version`. It verifies the metadata, lockfile, internal pins
   and matching release notes. Typechecking, normal builds and full certification
   invoke it too. CI version tags must be exactly `vVERSION`.

## Certify and package

Run `npm run test:full` against final source. It builds once and verifies every
required owner on immutable artifacts with one run identity. On a prepared build,
follow [the testing instructions](testing/README.md); unrelated focused runs and
PR reports cannot authorize release. Changing the version changes the artifacts
and requires new evidence. Record actual outcomes and limitations under that
version, never copy an old pass to a new number.

Only after full certification, run:

```sh
npm run package:extension
npm run package:api
```

These verify the evidence again and never rebuild. Outputs are new candidates
under `output/releases`: `tholi-VERSION.zip`, `tholi-firefox-VERSION.zip` and
`tholi-api-VERSION.tgz`, with their existing checksum/evidence records. Existing
archives stay immutable. Chromium evidence cannot certify Firefox bytes.

Review native installation and permissions, documented manual checks, candidate
checksums and release notes before publication. The full-validation workflow runs
nightly, manually or on a matching version tag; its packaging input is explicit.
It does not submit browser-store releases. A successful local build, a tag or a
candidate archive alone does not mean the release has been published.

See [browser-store submission](store-submission.md) for the target-specific
uploads, permission explanations and matching Firefox reviewer source build.
