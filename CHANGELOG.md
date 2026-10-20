# Tholi changelog

## Website 0.1.0 · October 20, 2026

Published on GitHub as [web-v0.1.0](https://github.com/Sammieblz/tholi/releases/tag/web-v0.1.0),
merged into `main` through [PR #22](https://github.com/Sammieblz/tholi/pull/22)
and deployed on Cloudflare Pages at [tholi.io](https://tholi.io).

GSAP section reveals, a header that returns on upward scroll, self-hosted editorial
typography, clearer signup entry points, and illustrated Chrome/Firefox setup
cards. Accounts and store destinations remain explicit previews. Website delivery
uses independent `web-vVERSION` tags. The published source prerelease has no
certified website ZIP; full certification remains required before packaging.
Support and Contact pages add current help resources and a local email-draft
form. The hero uses one installation action and a practice action; About credits
the Zulu name umtholi (“finder”).
[Website release notes](docs/releases/website/v0.1.0/README.md).

## 0.11.0 · Unreleased

Firefox AMO packaging follow-up: write portable ZIP paths and verify stored
names without hiding Windows backslashes. The corrected
`tholi-firefox-0.11.0-amo.zip` retains the original certified file contents;
Mozilla's validator reports zero errors and 12 bundled-code warnings. See the
[archive repair record](docs/releases/v0.11.0/validation.md#october-20-firefox-amo-archive-repair).

Performance follow-up: responsive Pause/Stop, bounded recovery, widget scan
exclusion, idle worker release and dense-page cache reuse.
[Measurements and validation scope](docs/releases/v0.11.0/performance.md).

Optional assisted navigation, quieter scan recovery, improved intent/context
handling, bounded inference scheduling and focused OCR. Versions are synchronized
across product components. [Release notes, compatibility and known limits](docs/releases/v0.11.0/README.md) ·
[Validation status](docs/releases/v0.11.0/validation.md).

## Earlier source versions

- [0.10.1: UI, website, browser support and repository cleanup records](docs/README.md#design-and-implementation-records).
- [0.10.0 validation and artifacts](docs/releases/v0.10.0/validation.md).
- [Older versioned records](docs/README.md#historical-evidence-and-specialized-fixtures).

Source versions, eligible downloads and published releases are distinct. Dated
records describe their original tested bytes; they do not certify a later build.
