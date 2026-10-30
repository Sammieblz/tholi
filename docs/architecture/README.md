# Architecture

- [Navigation, discovery, grounding and verification](navigation.md)
- [Page context and experimental browser language model](page-context.md)
- [Bundled NLP and indexing](natural-language.md)
- [Session, document and worker continuity](sessions.md)
- [Authored fixture routes and registry contracts](authored-routes.md)
- [Portable backend architecture and service contracts](../plans/gemini-cloud-and-enterprise.md), including local/VM/cloud profiles and legacy compatibility
- [Current API profiles, runtime ownership and lifecycle](backend.md)
- [PostgreSQL schema, migrations and scoped repositories](../development/service-database.md)
- [Versioned service APIs, discovery and request policy](../development/service-api.md)
- [Optional identity, website cookies and native client sessions](../development/service-identity.md)
- [Workspace roles, tenant isolation and purpose-specific consent](../development/service-authorization.md)
- [Durable worker, PostgreSQL leases and scheduling](../development/service-jobs.md)
- [Account support, notification mail and private files](../development/service-support.md)
- [Gateway, CDN, TLS and optional edge delivery](../development/service-delivery.md)
- [Portable observability, audit metadata and consented analytics](../development/service-observability.md)
- [Developer privacy](privacy.md) and [security boundaries](security.md)
- [Frontend ownership](frontend/README.md), including [extension](frontend/extension.md), [website](frontend/website.md) and [shared UI](frontend/shared-ui.md)

Public launch-review legal drafts are maintained separately in `apps/web/src/features/legal`, rendered at `/privacy`, `/terms` and `/cookies`. Developer privacy/security contracts are not substitutes for those policies.
