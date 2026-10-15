# Documentation

Current setup and behavior are described in [the project README](../README.md). Versioned validation files are historical snapshots of specific tested bytes; they are not installation instructions for the current working tree.

## Current references

- [Chrome setup, permissions and native verification](chrome-handoff.md)
- [Shared discovery, planning and verification architecture](live-navigation.md)
- [Workflow capability matrix](v0.8.0-capabilities.md)
- [NLP and indexing](nlp-architecture.md)
- [Page context and experimental Chrome model](page-context.md)
- [Continuous journeys and return routing](task-routing.md)
- [Session lifecycle](session-lifecycle.md)
- [Guidance and accessibility](passive-guidance.md)
- [Privacy](privacy.md) and [security](security.md)
- [Optional API setup](api-setup.md)
- [Diagnostics](live-diagnostics.md)
- [Dashboard settings navigation fix and verification](dashboard-navigation.md)
- [Cleanup scope and verification](maintenance.md)
- [Contribution and release procedure](../CONTRIBUTING.md)
- [Frontend structure and ownership](frontend-architecture.md)
- [Current UI refinement, motion, and installed skills](ui-refinement.md)
- [Adaptive website contrast and theme detection](adaptive-appearance.md)
- [Real website screenshot sources and regeneration](product-screenshots.md)

## Historical evidence and specialized fixtures

- [v0.9.1 reliability candidate](v0.9.1-validation.md): pre-cleanup metrics, failed Paddle startup and pending signed-in checks
- [v0.9.0 continuity/OCR](v0.9.0-validation.md)
- [v0.8.0 workflows](v0.8.0-validation.md) and [contract design](v0.8.0-architecture.md)
- [v0.7.1 References/Privacy fixes](v0.7.1-navigation-fixes.md), [v0.7.0 NLP](v0.7.0-validation.md)
- [Frozen accuracy matrix](accuracy-benchmark.md) and [earlier build evidence](build-evidence.md)
- Controlled Northstar demo: [route authoring](route-authoring.md), [registry](route-registry.md)

The authored demo route engine remains separate because it supplies deterministic regression fixtures. Product live discovery must not inherit its fixed routes or selectors.

- [Tholi UI, floating widget, and local website](tholi-ui.md)

- [Tholi 0.10.0 validation and artifacts](v0.10.0-validation.md)
