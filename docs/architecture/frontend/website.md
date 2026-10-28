# Website ownership

The website keeps feature-local components, styles and state. `app` owns routing and browser history; `components/SiteLayout` owns shared navigation/footer.

The practice has three explicit responsibilities: `practice.ts` defines sample goals and preferences, `usePracticeAdapter.ts` supplies controlled product presentation and actions, and `PracticeWorkspace.tsx` renders the sample website around the actual shared guidance components. `Demo.tsx` composes them. Practice verification comes from actual sample interactions, independently of production journeys.

`legal/content.tsx` owns launch-review draft sections. `LegalPage.tsx` renders them and consent settings. `legal/operator.ts` owns operator details. Source links import canonical repository metadata from `config/project.ts`, independently of the lazy Markdown registry.

Documentation imports allowlisted current Markdown. Public article slugs are stable across repository moves; legacy source references resolve through explicit aliases. Historical evidence stays a repository link. No raw HTML or arbitrary remote image execution is enabled.

The public website is account-free. Retired sign-in, sign-up and welcome routes redirect to downloads; draft account components are outside the production route/provider tree. Future real accounts, cloud-saved data, credits and subscriptions extend these owners under the [portable backend plan](../../plans/gemini-cloud-and-enterprise.md). Practice remains isolated from installed extension state. Analytics is unconfigured and opt-in storage is governed by actual cookie consent. Genuine media files and their original provenance remain immutable.
