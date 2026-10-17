# Website ownership

The website keeps feature-local components, styles and state. `app` owns routing and browser history; `components/SiteLayout` owns shared navigation/footer.

The practice has three explicit responsibilities: `practice.ts` defines sample goals and preferences, `usePracticeAdapter.ts` supplies controlled product presentation and actions, and `PracticeWorkspace.tsx` renders the sample website around the actual shared guidance components. `Demo.tsx` composes them. Practice verification comes from actual sample interactions, independently of production journeys.

`legal/content.tsx` owns launch-review draft sections. `LegalPage.tsx` renders them and consent settings. `legal/operator.ts` owns operator details. Source links import canonical repository metadata from `config/project.ts`, independently of the lazy Markdown registry.

Documentation imports allowlisted current Markdown. Public article slugs are stable across repository moves; legacy source references resolve through explicit aliases. Historical evidence stays a repository link. No raw HTML or arbitrary remote image execution is enabled.

Accounts remain visibly mocked, passwords unpersisted, analytics unconfigured and opt-in storage governed by actual cookie consent. Genuine media files and their original provenance remain immutable.
