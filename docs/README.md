# Tholi documentation

Current setup and behavior are described in [the project README](../README.md). Versioned validation files are historical snapshots of specific tested bytes; they are not installation instructions for the current working tree.

## Using Tholi

- [Browser setup, permissions and native verification](guides/getting-started.md)
- [Guide, Conversation, widget and local website](guides/using-tholi.md)
- [Continuous journeys and return routing](guides/journeys.md)
- [Session lifecycle](architecture/sessions.md)
- [Appearance and website contrast](guides/appearance.md)
- [Privacy](architecture/privacy.md) and [security](architecture/security.md)
- [Optional API setup](guides/backend.md)
- [Diagnostics](guides/troubleshooting.md)

The local website at **http://127.0.0.1:5174/docs** publishes selected current references with search and heading links.

## Building Tholi

- [Contribution and release procedure](../CONTRIBUTING.md)
- [Frontend structure and ownership](architecture/frontend/README.md)
- [Shared discovery, planning and verification architecture](architecture/navigation.md)
- [NLP and indexing](architecture/natural-language.md)
- [Page context and experimental Chrome model](architecture/page-context.md)
- [Guidance and accessibility](architecture/frontend/guidance.md)
- [Product naming, metadata and compatibility](development/naming.md)
- [Project-local design skills and provenance](../.codex/README.md)

## Releases

- [0.11.0 release notes and compatibility](releases/v0.11.0/README.md) · [validation status](releases/v0.11.0/validation.md)
- [Changelog](../CHANGELOG.md) and [versioning/release procedure](development/releasing.md)

## Design and implementation records

- [Navigation responsiveness, cancellation and memory follow-up](releases/v0.11.0/performance.md)
- [Navigation recovery, context, assisted mode and validation](releases/v0.11.0/navigation-reliability.md)
- [Current UI audit, implementation, skills, and validation](releases/v0.10.1/ui-audit.md)
- [Real website screenshot sources and regeneration](development/media-capture.md)
- [Website redesign, genuine video, public docs, cookie controls and launch drafts](releases/v0.10.1/website.md)
- [Dashboard settings navigation fix and verification](releases/v0.9.2/navigation.md)
- [Reliability cleanup scope and verification](releases/records/2026-10-maintenance.md)

## Historical evidence and specialized fixtures

- [Tholi 0.10.0 validation and artifacts](releases/v0.10.0/validation.md)
- [v0.9.1 reliability candidate](releases/v0.9.1/validation.md): pre-cleanup metrics, failed Paddle startup and pending signed-in checks
- [v0.9.0 continuity/OCR](releases/v0.9.0/validation.md)
- [v0.8.0 workflow capabilities](releases/v0.8.0/capabilities.md), [validation](releases/v0.8.0/validation.md) and [contract design](releases/v0.8.0/architecture.md)
- [v0.7.1 References/Privacy fixes](releases/v0.7.1/navigation-fixes.md), [v0.7.0 NLP](releases/v0.7.0/validation.md)
- [Frozen accuracy matrix](development/testing/acceptance.md) and [earlier build evidence](releases/records/legacy-build-evidence.md)
- Controlled Northstar demo: [authored routes and registry](architecture/authored-routes.md)

The authored demo route engine remains separate because it supplies deterministic regression fixtures. Product live discovery must not inherit its fixed routes or selectors.

## Repository development

- [Architecture index](architecture/README.md)
- [Local Graphify and Obsidian knowledge graph](development/knowledge-graph.md)
- [Testing, projects, CI and release evidence](development/testing/README.md)
- [Coverage ownership and removed duplication](releases/v0.10.1/coverage-ledger.md)
- [Cleanup measurements](releases/v0.10.1/repository-cleanup.md)

Release records are grouped by version under `releases/vVERSION`. Unversioned October 2026 history stays under `releases/records`; it makes no current guarantee.

- [Browser adapters and target builds](architecture/browser-platforms.md)
- [Chromium and Firefox implementation evidence](releases/v0.10.1/browser-support.md)
