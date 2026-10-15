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
.handle button{display:inline-grid;place-items:center;background:transparent;border:0;min-width:28px;width:28px;height:28px;border-radius:4px;padding:0}
.handle>div{display:flex;align-items:center;gap:2px}
.resize{position:absolute;bottom:0;right:0;width:28px;height:28px;cursor:nwse-resize;touch-action:none;background:var(--bar);border:0;color:var(--accent);border-radius:8px 0 0}
iframe{border:0;width:100%;height:calc(100% - 28px);display:block}
.launcher{display:grid;place-items:center;width:44px;height:44px;border:0;padding:4px;border-radius:50%;background:var(--shell);color:var(--text);cursor:pointer}
.launcher:focus-visible{outline:2px solid var(--accent);outline-offset:-3px}
.launcher-help{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.launcher-actions{position:absolute;top:52px;display:flex;gap:4px;padding:5px;min-width:min(190px,calc(100vw - 16px));max-width:calc(100vw - 16px);border:1px solid var(--edge);border-radius:12px;background:var(--shell);box-shadow:0 4px 16px #0002;color:var(--text);font:12px/1.4 system-ui}
.launcher-actions[hidden]{display:none}
:host([data-controls-above=true]) .launcher-actions{top:auto;bottom:52px}
.launcher-actions button{display:flex;align-items:center;justify-content:center;gap:5px;min-height:36px;padding:7px 9px;white-space:nowrap;border:0;border-radius:7px;background:transparent}
.launcher-actions .launcher-remove{background:var(--bar)}
.launcher-notice{position:absolute;right:0;top:52px;width:min(240px,calc(100vw - 24px));padding:10px;border:1px solid var(--edge);border-radius:8px;background:var(--shell);color:var(--text);box-shadow:0 4px 16px #0002;font:12px/1.5 system-ui;pointer-events:none}
.launcher-notice[hidden]{display:none}
.dock-preview{position:absolute;right:8px;top:36px;z-index:4;padding:8px 10px;border:1px solid var(--edge);border-radius:8px;background:var(--bar);color:var(--text);font:12px system-ui;pointer-events:none;box-shadow:0 4px 16px #0002}
.dock-preview[hidden],.shell-notice[hidden]{display:none}
.shell-notice{position:absolute;inset:36px 8px auto;z-index:5;padding:10px;border:1px solid var(--edge);border-radius:8px;background:var(--shell);color:var(--text);font:12px/1.5 system-ui;box-shadow:0 4px 16px #0002}
@media(forced-colors:active){.launcher,.launcher-actions,.dock-preview,.shell-notice{border:1px solid ButtonText}.launcher svg{forced-color-adjust:auto}}
@media(hover:hover) and (pointer:fine){button:hover{filter:brightness(.95)}}
`;
