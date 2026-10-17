/** The same decorative marker is used in trusted React views and the page launcher.
 * No page text, private data or caller-provided markup is interpolated here. */
export type WayfinderState =
  | "idle"
  | "planning"
  | "guiding"
  | "verifying"
  | "attention"
  | "paused"
  | "arrived"
  | "unresolved";

export const wayfinderStyles = `
.tholi-wayfinder{display:inline-flex;flex:none;align-items:center;justify-content:center;width:36px;height:36px;vertical-align:middle;isolation:isolate}
.tholi-wayfinder svg{display:block;width:100%;height:100%;overflow:visible}
.tholi-wayfinder .wf-seed,.tholi-wayfinder .wf-symbol,.tholi-wayfinder .wf-path,.tholi-wayfinder .wf-shadow{transform-origin:24px 24px;transition:opacity 180ms var(--ease-out,cubic-bezier(.23,1,.32,1)),transform 240ms var(--ease-in-out,cubic-bezier(.77,0,.175,1))}
.tholi-wayfinder .wf-seed{transform:scale(.76)}
.tholi-wayfinder .wf-path,.tholi-wayfinder .wf-symbol,.tholi-wayfinder .wf-route-orbit{opacity:0}
.tholi-wayfinder .wf-route-orbit{transform-origin:24px 24px;transition:opacity 180ms var(--ease-out,cubic-bezier(.23,1,.32,1))}
.tholi-wayfinder .wf-symbol{fill:none;stroke:#68440c;stroke-width:2.7;stroke-linecap:round;stroke-linejoin:round}
.tholi-wayfinder .wf-shadow{opacity:.16}
.tholi-wayfinder .wf-terminal{opacity:0}
.tholi-wayfinder .wf-piece{transform-origin:24px 24px}
.tholi-wayfinder[data-state=idle][data-animate=true] .wf-seed{animation:tholi-wayfinder-breathe 3.6s var(--ease-in-out,cubic-bezier(.77,0,.175,1)) infinite}
.tholi-wayfinder[data-state=guiding] .wf-path,.tholi-wayfinder[data-state=planning] .wf-path,.tholi-wayfinder[data-state=guiding] .wf-route-orbit,.tholi-wayfinder[data-state=planning] .wf-route-orbit{opacity:1}
.tholi-wayfinder[data-state=guiding] .wf-seed{transform:scale(.44)}
.tholi-wayfinder[data-state=guiding] .wf-shadow,.tholi-wayfinder[data-state=planning] .wf-shadow{opacity:0}
.tholi-wayfinder[data-state=planning] .wf-seed{transform:scale(.35)}
.tholi-wayfinder[data-state=guiding][data-animate=true] .wf-route-orbit{animation:tholi-wayfinder-route 2.8s linear infinite}
.tholi-wayfinder[data-state=planning][data-animate=true] .wf-route-orbit{animation:tholi-wayfinder-route 1.8s linear infinite}
.tholi-wayfinder[data-state=verifying] .wf-seed{transform:scale(.66)}
.tholi-wayfinder[data-state=verifying][data-animate=true] .wf-checking{opacity:1;animation:tholi-wayfinder-checking 1.6s linear infinite}
.tholi-wayfinder[data-state=attention] .wf-seed{transform:scale(.86)}
.tholi-wayfinder[data-state=attention] .wf-attention,.tholi-wayfinder[data-state=paused] .wf-pause{opacity:1}
.tholi-wayfinder[data-state=paused] .wf-seed{transform:scale(.95)}
.tholi-wayfinder:is([data-state=arrived],[data-state=unresolved]) .wf-seed,.tholi-wayfinder:is([data-state=arrived],[data-state=unresolved]) .wf-shadow{opacity:0}
.tholi-wayfinder:is([data-state=arrived],[data-state=unresolved]) .wf-terminal{opacity:1}
.tholi-wayfinder[data-state=arrived] .wf-piece-a{transform:translate(-7px,2px) rotate(45deg) scale(.43,.35)}
.tholi-wayfinder[data-state=arrived] .wf-piece-b{transform:translate(4px,-1px) rotate(-48deg) scale(.75,.35)}
.tholi-wayfinder[data-state=unresolved] .wf-piece-a{transform:rotate(45deg) scale(.88,.35)}
.tholi-wayfinder[data-state=unresolved] .wf-piece-b{transform:rotate(-45deg) scale(.88,.35)}
.tholi-wayfinder[data-morph=true]:is([data-state=arrived],[data-state=unresolved]) .wf-seed{animation:tholi-wayfinder-release 420ms var(--ease-out,cubic-bezier(.23,1,.32,1)) both}
.tholi-wayfinder[data-morph=true][data-state=arrived] .wf-piece-a{animation:tholi-wayfinder-check-a 420ms var(--ease-in-out,cubic-bezier(.77,0,.175,1)) both}
.tholi-wayfinder[data-morph=true][data-state=arrived] .wf-piece-b{animation:tholi-wayfinder-check-b 420ms var(--ease-in-out,cubic-bezier(.77,0,.175,1)) both}
.tholi-wayfinder[data-morph=true][data-state=unresolved] .wf-piece-a{animation:tholi-wayfinder-cross-a 420ms var(--ease-in-out,cubic-bezier(.77,0,.175,1)) both}
.tholi-wayfinder[data-morph=true][data-state=unresolved] .wf-piece-b{animation:tholi-wayfinder-cross-b 420ms var(--ease-in-out,cubic-bezier(.77,0,.175,1)) both}
@keyframes tholi-wayfinder-release{0%{opacity:1;transform:scale(var(--wf-from-scale,.76))}28%{opacity:.15;transform:scale(.65)}40%,100%{opacity:0;transform:scale(.6)}}
@keyframes tholi-wayfinder-check-a{0%{opacity:0;transform:translate(-5px,0) scale(.55,1.7)}20%{opacity:1;transform:translate(-5px,0) scale(.55,1.7)}100%{opacity:1;transform:translate(-7px,2px) rotate(45deg) scale(.43,.35)}}
@keyframes tholi-wayfinder-check-b{0%{opacity:0;transform:translate(5px,0) scale(.55,1.7)}20%{opacity:1;transform:translate(5px,0) scale(.55,1.7)}100%{opacity:1;transform:translate(4px,-1px) rotate(-48deg) scale(.75,.35)}}
@keyframes tholi-wayfinder-cross-a{0%{opacity:0;transform:translate(-5px,0) scale(.55,1.7)}20%{opacity:1;transform:translate(-5px,0) scale(.55,1.7)}100%{opacity:1;transform:rotate(45deg) scale(.88,.35)}}
@keyframes tholi-wayfinder-cross-b{0%{opacity:0;transform:translate(5px,0) scale(.55,1.7)}20%{opacity:1;transform:translate(5px,0) scale(.55,1.7)}100%{opacity:1;transform:rotate(-45deg) scale(.88,.35)}}
@keyframes tholi-wayfinder-breathe{0%,100%{transform:scale(.76)}50%{transform:scale(.86)}}
@keyframes tholi-wayfinder-route{to{transform:rotate(360deg)}}
@keyframes tholi-wayfinder-checking{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.tholi-wayfinder *{animation:none!important;transition-duration:80ms!important}.tholi-wayfinder[data-state=planning] .wf-seed{transform:scale(.35)}.tholi-wayfinder[data-state=verifying] .wf-checking{opacity:1}}
@media(forced-colors:active){.tholi-wayfinder .wf-terminal rect{fill:CanvasText}.tholi-wayfinder .wf-terminal path{stroke:Canvas}}
`;

/** Update persistent geometry. Loop visibility never replays a terminal morph. */
export function updateWayfinder(
  marker: HTMLElement,
  state: WayfinderState,
  animate = true,
) {
  const moving = animate && marker.ownerDocument.visibilityState !== "hidden";
  if (marker.dataset.state !== state) {
    const scales: Record<string, string> = {
      idle: ".76",
      planning: ".35",
      guiding: ".44",
      verifying: ".66",
      attention: ".86",
      paused: ".95",
    };
    marker.style.setProperty(
      "--wf-from-scale",
      scales[marker.dataset.state || "idle"] || ".76",
    );
    marker.dataset.morph = String(
      moving && (state === "arrived" || state === "unresolved"),
    );
    marker.dataset.state = state;
  }
  marker.dataset.animate = String(moving);
}

export function wayfinderMarkup({
  state,
  instance = "marker",
  animate = true,
}: {
  state: WayfinderState;
  instance?: string;
  animate?: boolean;
}) {
  const known: WayfinderState[] = [
    "idle",
    "planning",
    "guiding",
    "verifying",
    "attention",
    "paused",
    "arrived",
    "unresolved",
  ];
  const safeState = known.includes(state) ? state : "idle";
  const id = "tholi-wayfinder-" + instance.replace(/[^a-zA-Z0-9_-]/g, "");
  const piece = `<rect x="9" y="17" width="30" height="14" rx="7" fill="url(#${id})"/><path d="M15 20h18" stroke="#fff6dc" stroke-opacity=".5" stroke-width="1.2" stroke-linecap="round"/>`;
  return `<span class="tholi-wayfinder" data-state="${safeState}" data-animate="${animate}" data-morph="false" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><defs><linearGradient id="${id}" x1="14" y1="12" x2="33" y2="38" gradientUnits="userSpaceOnUse"><stop stop-color="#f4ce88"/><stop offset=".48" stop-color="#e6af57"/><stop offset="1" stop-color="#c78c34"/></linearGradient></defs><ellipse class="wf-shadow" cx="24" cy="38" rx="12" ry="2.3" fill="#714b16"/><g class="wf-path" stroke="#e6af57" stroke-linecap="round"><path d="M8 24a16 16 0 0 1 28-10M40 24a16 16 0 0 1-28 10" stroke-opacity=".5" stroke-width="1.8"/><path d="M24 13v3m0 16v3M13 24h3m16 0h3" stroke-opacity=".6" stroke-width="1.5"/></g><g class="wf-route-orbit"><circle cx="8.1" cy="22.3" r="1.1" fill="#e6af57" opacity=".2"/><circle cx="9.5" cy="17.2" r="1.6" fill="#e6af57" opacity=".45"/><circle cx="12.7" cy="12.7" r="3.4" fill="url(#${id})"/><circle cx="12" cy="11.7" r=".9" fill="#fff6dc" opacity=".8"/></g><g class="wf-seed"><circle cx="24" cy="24" r="15" fill="url(#${id})"/><path d="M16 17c3-4 10-5 15-1" stroke="#fff6dc" stroke-opacity=".65" stroke-width="1.5" stroke-linecap="round"/></g><g class="wf-terminal"><g class="wf-piece wf-piece-a">${piece}</g><g class="wf-piece wf-piece-b">${piece}</g></g><path class="wf-symbol wf-pause" d="M20 18v12m8-12v12"/><path class="wf-symbol wf-attention" d="M24 17v8m0 5h.01"/><circle class="wf-symbol wf-checking" cx="24" cy="24" r="17" stroke-dasharray="16 92"/></svg></span>`;
}
