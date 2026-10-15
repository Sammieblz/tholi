export const overlayStyles = `
:host{all:initial;--surface:#faf7f0;--ink:#1c2522;--accent:#1f6b57;--line:#bdcdbf;--warning:#745014;color-scheme:light}
:host([data-tholi-theme=dark]){--surface:#111b17;--ink:#faf7f0;--accent:#90c8b1;--line:#496354;--warning:#f0c779;color-scheme:dark}
*{box-sizing:border-box}
.halo,.glow{position:fixed;border:3px solid var(--accent);border-radius:10px;box-shadow:0 0 0 2px var(--surface),0 0 0 5px #1f6b5730;pointer-events:none}
.glow{border-color:#e6af57;box-shadow:0 0 0 8px #e6af5740;opacity:0}
.tip{position:fixed;width:min(278px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:hidden;padding:14px 16px;background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:16px;font:14px/1.5 Inter,system-ui;box-shadow:0 8px 28px #0003;pointer-events:none;overflow-wrap:anywhere}
.brand{display:block;color:var(--accent);font-size:12px;font-weight:650;margin-bottom:6px}
.brand::before{content:'';display:inline-block;width:7px;height:7px;border-radius:50%;background:#e6af57;margin-right:7px}
.warning{border-color:var(--warning)}
.arrow{position:fixed;background:var(--surface);color:var(--ink);border:2px solid var(--accent);border-radius:14px;padding:12px;font:14px Inter,system-ui;display:flex;gap:8px;align-items:center}
.arrow svg{width:22px;height:22px;animation:direction 900ms cubic-bezier(.77,0,.175,1) 3}
.arrow[data-direction=up]{--dx:0px;--dy:-6px}
.arrow[data-direction=down]{--dx:0px;--dy:6px}
.arrow[data-direction=left]{--dx:-6px;--dy:0px}
.arrow[data-direction=right]{--dx:6px;--dy:0px}
@keyframes direction{50%{transform:translate(var(--dx),var(--dy))}}
@media(prefers-reduced-motion:reduce){.halo,.tip,.arrow svg{animation:none}}
[hidden]{display:none!important}
`;
