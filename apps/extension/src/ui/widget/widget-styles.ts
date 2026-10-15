/** Page shell only. The extension-origin iframe owns the full guidance design. */
export const widgetStyles = `
*{box-sizing:border-box}
:host{--shell:#faf7f0;--bar:#e5ede5;--text:#1c2522;--accent:#1f6b57;--edge:#bdcdbf;color-scheme:light;background:var(--shell)}
:host([data-tholi-theme=dark]){--shell:#111b17;--bar:#243d32;--text:#faf7f0;--accent:#90c8b1;--edge:#496354;color-scheme:dark}
.handle{height:28px;background:var(--bar);display:flex;align-items:center;justify-content:space-between;padding:0 8px;font:11px system-ui;color:var(--text);cursor:move;touch-action:none;gap:8px}
.handle>span{display:flex;align-items:center;gap:8px;font-weight:600}
.handle>span::before{content:'';width:14px;height:3px;border-block:1px solid var(--accent);opacity:.65}
.handle:focus-visible,.resize:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
button{font:inherit;cursor:pointer;color:var(--text)}
.handle button{background:transparent;border:0;min-width:44px;height:28px;border-radius:4px}
.resize{position:absolute;bottom:0;right:0;width:28px;height:28px;cursor:nwse-resize;touch-action:none;background:var(--bar);border:0;color:var(--accent);border-radius:8px 0 0}
iframe{border:0;width:100%;height:calc(100% - 28px);display:block}
.layout{position:absolute;right:8px;top:32px;z-index:2;width:200px;max-height:calc(100% - 40px);overflow:auto;padding:12px;background:var(--shell);color:var(--text);border:1px solid var(--edge);border-radius:10px;box-shadow:0 8px 24px #0002;font:12px system-ui}
.layout[hidden]{display:none}
.layout p{margin:0 0 8px;font-weight:600}
.layout>div{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px}
.layout button{min-height:36px;border:1px solid var(--edge);border-radius:6px;background:var(--bar)}
@media(hover:hover) and (pointer:fine){button:hover{filter:brightness(.95)}}
`;
