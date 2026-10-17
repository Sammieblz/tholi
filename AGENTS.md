# Tholi development guidance

## UI, UX, and motion

Before UI work, read the relevant project-local skills in `.codex/skills`, not only a global copy. The inventory, upstream revisions, licenses, and SHA-256 hashes are in `.codex/skills-manifest.json`.

- Layout, hierarchy, typography, and brand: `apple-design/SKILL.md`, `ui-ux-pro-max/SKILL.md`, and `baseline-ui/SKILL.md`. Load the Apple references relevant to the actual surface.
- Interactive controls and forms: `fixing-accessibility/SKILL.md`.
- Animation implementation: `animate/SKILL.md` and `emil-design-eng/SKILL.md`; use `fixing-motion-performance/SKILL.md` or `animation-performance/SKILL.md` when measuring or changing motion mechanisms.
- Read-only audits: `improve-ui/SKILL.md` and `improve-animations/SKILL.md`. Use the approved plan and implementation skills for execution.

Reference the exact skill guidance applied in the change record with its validation. Keep copied upstream skill files intact. User instructions and the accepted product plan take precedence over generic recommendations in skills.

The accepted stack is React, Base UI, Iconoir, and existing CSS/WAAPI motion. Preserve it. Generic skill suggestions to migrate to Tailwind or another motion library do not apply to this product. Extend the existing easing, palette, spacing, and presentation tokens. Amber is the stateful wayfinder, jade is the guide; preserve the supplied wordmark and brand colors. No em dashes in product copy or decorative dash prefixes on section labels.

## Ownership and truth

`packages/ui` owns reusable presentation. The extension worker owns the journey. The website demo uses shared product components with an explicitly controlled local adapter. Keep browser privileges and credentials out of shared components and website previews.

Animations cannot establish completion. Arrival needs verified outcome evidence. Preserve frozen NLP/Wikipedia inputs, route eligibility, review boundaries, host-permission checks, private session storage, and OCR masking. Surface changes do not stop or reset a journey. Distinguish Stop, Reset current session, Reset position, and knowledge deletion.

Keep feature-oriented frontend ownership. Avoid parallel styles, imitation product interfaces, inert controls, and broad folder rearrangements. Website delivery is local-only unless the user requests hosting. Mock accounts never send or persist passwords. New downloads must pass existing packaging gates; preserve truthful version and checksum information.

## Verification

Run focused checks during implementation, then strict TypeScript, unit tests, builds, and the complete UI regression on matching final extension bytes. Test narrow/compact sizes, 200% zoom, both appearances, keyboard use, reduced motion, and stable state identity. Record native Chrome, screen-reader, and signed-in checks separately when they have not been performed. Do not call fixture passes real-site passes.
