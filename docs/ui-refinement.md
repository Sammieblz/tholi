# Tholi 0.10.1 interface refinement

The design thesis is a guide that keeps one destination and one next step in view. A quiet route line connects the current guidance; a connected marker anchors the website demonstration. The supplied palette stays authoritative. Inter remains bundled, with lighter display weights and tighter tracking reserved for headlines. Iconoir remains the functional icon set.

Computed contrast: charcoal on ivory 14.68:1, secondary text on ivory 6.26:1, white on jade buttons 6.37:1, and dark-theme secondary text on its background 9.86:1. The editable-field boundary is 3.30:1 against the card surface. These are token checks; native screen-reader and real-device checks remain separate.

## Installed and applied skills

The requested skills are installed under `C:/Users/samue/.codex/skills`, outside the repository. They become available for automatic selection next turn. This pass reads their installed instructions directly.

| Source                                                                   | Installed folders                                     | Pinned upstream revision                   |
| ------------------------------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------ |
| [Apple Design](https://github.com/dickwu/apple-design-skill)             | `apple-design`                                        | `904b0eedc7cc778152f545506075d5bb5219ce77` |
| [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | `ui-ux-pro-max`                                       | `7246805992a42b7bba37d4cac83b01416f0c6c44` |
| [Emil Kowalski](https://github.com/emilkowalski/skills)                  | `animate`, `emil-design-eng`, `animation-performance` | `2d228630ba1446365f614a108cb8252f1feda202` |

Apple references consulted cover accessibility, layout, typography, color, desktop context, motion, loading, feedback, branding, and cross-platform translation. These inform web interaction principles rather than imitation macOS chrome. Specific applications: `layout.md` under Visual hierarchy supports progressive disclosure; `motion.md` under Providing feedback supports brief, cancellable feedback; `branding.md` under Best practices supports restrained emphasis and familiar controls.

UI UX Pro Max searches used `navigation assistant warm minimal` for the design system, `dragging movements` for accessible alternatives, and `component composition state` for React ownership. The minimalism result fits Tholi. Generic palette/font recommendations were discarded in favor of the supplied brand and bundled Inter. The dragging result informed the widget Layout controls.

Emil's construction sequence and component recipes informed timing, trigger origins, interruption, reduced motion, and use of CSS/WAAPI. No animation framework was installed. Dragging directly updates geometry rather than animating through React state.

## Applied review

| Before                             | After                                                                | Why                                           |
| ---------------------------------- | -------------------------------------------------------------------- | --------------------------------------------- |
| Similar sage cards throughout      | A distinct current-step surface with a route rail                    | Hierarchy carries the task                    |
| Abrupt mode selection              | A 240 ms sliding selection                                           | Preserve spatial continuity                   |
| Mostly static website              | Hero sequence, one-time section reveals, staged demo feedback        | Explain the product through interaction       |
| Repeated headline/card treatment   | Quiet typography and connected sample-browser guidance               | Spend emphasis on wayfinding                  |
| One large website component        | Page features, session state, routing, layout, local styles          | Grow features without editing unrelated forms |
| Effects mixed with advanced markup | Controller hook, compositional screen, advanced and journey features | Keep lifecycle ownership clear                |
| Drag/keyboard positioning          | Layout buttons for position and size                                 | Add a single-pointer alternative              |
| Entry only on node creation        | Fresh-target fades on stable target identity                         | Avoid replay during geometry refresh          |

## Motion contract

| Moment                    | Driver and timing                                     | Purpose                                  |
| ------------------------- | ----------------------------------------------------- | ---------------------------------------- |
| Press                     | CSS transform, 120 ms                                 | Immediate acknowledgement                |
| Instruction               | CSS opacity/6 px translation, 160 ms, stable step key | Make the new instruction legible         |
| Highlight                 | WAAPI opacity, 180 ms entrance / 120 ms exit          | Reveal a fresh binding without moving it |
| Menu/settings             | Trigger-origin opacity/scale, 180 to 200 ms           | Show the surface's origin                |
| Mode selection            | CSS transform, 240 ms                                 | Spatial continuity                       |
| Widget mount / move aside | WAAPI, 180 / 240 ms                                   | Reveal and explain relocation            |
| Website hero / sections   | CSS/WAAPI, 600 to 700 ms, 50 ms hero stagger          | First-visit explanation                  |
| Arrival                   | Check/marker, 420 ms                                  | Confirm a verified outcome               |

UI entry uses `cubic-bezier(0.23,1,0.32,1)`; deliberate movement uses `cubic-bezier(0.77,0,0.175,1)`. Reminders remain four 1.2-second glow cycles after four idle seconds. Scroll arrows move in the required direction three times at 900 ms, then remain static. No artificial route percentage, simulated streaming, or fabricated reasoning is added.

Reduced motion removes repeated/spatial effects. Shared surfaces suppress decorative transitions for keyboard interactions. Drag, keyboard movement, and resize stay direct. Pointer intervention cancels automatic widget movement. Section entrances run once and cancel when reduced motion becomes active. Interaction never waits for animation, and animation cannot establish arrival.

## Delivery and verification scope

The unpacked source build is **0.10.1**. The website still offers the immutable, checksum-verified **0.10.0** ZIP until a newer archive passes all release gates. This pass does not overwrite or re-certify that archive.

Focused checks cover strict TypeScript, existing unit tests, view continuity, widget frame isolation/capture exclusion, drag/resize and click alternatives, narrow/dark/reduced-motion layouts, mock account/onboarding, and download integrity. Screenshots cover website widths 375/768/1440, sidebar widths 300/380/620, 200% zoom, and widget standard/compact/minimum layouts.

Final checks on October 14, 2026: strict TypeScript passed; 178 unit tests across 21 files passed; all nine UI browser checks passed against extension 0.10.1 at `2026-10-14T17:58:36.323Z`. Extension and website production builds succeeded. The unpacked extension is 61,754,418 bytes, below 100 MB. The final synthetic mutation run retained its overlay root and measured 800 ms RAF p95; it does not pass a smooth-frame claim. Website preview on port 5174 returned HTTP 200. Download metadata still identifies 0.10.0 and its verified checksum.

Native Chrome permissions, screen-reader, and signed-in workflow checks remain pending. The 50,000-node mutation fixture retains the overlay, but page rendering can still stall its main thread. Compositor-friendly effects do not establish a 60 fps guarantee for that stress case. Exact latest measurements are in `output/qa/ui-build.json`.

Frozen NLP/Wikipedia inputs, safety thresholds, and outcome rules are unchanged. Run release gates against matching final bytes before packaging. This frontend pass makes no new claim about dashboard routing accuracy.
