/** Native shell controls stay outside the privileged React iframe. */
export function bindLauncherControls(
  host: HTMLElement,
  root: ShadowRoot,
  open: () => void,
  remove: () => Promise<void>,
  nativeSidebar: boolean,
) {
  const launcher = root.querySelector<HTMLButtonElement>(".launcher")!;
  const actions = root.querySelector<HTMLElement>(".launcher-actions")!;
  const removeButton =
    root.querySelector<HTMLButtonElement>(".launcher-remove")!;
  let pendingOpen: ReturnType<typeof setTimeout> | undefined;
  const cancelOpen = () => {
    clearTimeout(pendingOpen);
    pendingOpen = undefined;
  };
  const reveal = (shown: boolean, focus = false) => {
    cancelOpen();
    actions.hidden = !shown;
    host.dataset.controls = String(shown);
    const bounds = host.getBoundingClientRect();
    host.dataset.controlsAbove = String(bounds.bottom + 110 > innerHeight);
    if (shown) {
      const width = actions.getBoundingClientRect().width;
      actions.style.left =
        Math.max(8, Math.min(bounds.right - width, innerWidth - width - 8)) -
        bounds.left +
        "px";
    }
    host.style.overflow = shown ? "visible" : "hidden";
    launcher.setAttribute("aria-expanded", String(shown));
    if (focus) (shown ? removeButton : launcher).focus({ preventScroll: true });
  };
  launcher.onclick = (event) => {
    if (event.detail > 1) {
      reveal(true, true);
      return;
    }
    // Keyboard activation and the native sidebar keep their immediate gesture.
    // Widget restoration waits briefly so a double-click cannot reopen it first.
    if (event.detail === 0 || nativeSidebar) {
      open();
      return;
    }
    if (!actions.hidden) {
      reveal(false);
      open();
      return;
    }
    cancelOpen();
    pendingOpen = setTimeout(open, 400);
  };
  launcher.ondblclick = (event) => {
    event.preventDefault();
    reveal(true, true);
  };
  launcher.oncontextmenu = (event) => {
    event.preventDefault();
    reveal(true, true);
  };
  root.querySelector<HTMLButtonElement>(".launcher-open")!.onclick = open;
  removeButton.onclick = () => {
    cancelOpen();
    removeButton.disabled = true;
    void remove().catch(() => {
      removeButton.disabled = false;
      removeButton.focus({ preventScroll: true });
    });
  };
  const keys = (event: Event) => {
    const key = event as KeyboardEvent;
    if (key.key === "ContextMenu" || (key.shiftKey && key.key === "F10")) {
      key.preventDefault();
      reveal(true, true);
    } else if (key.key === "Escape") {
      key.preventDefault();
      reveal(false, true);
    }
  };
  const outside = (event: PointerEvent) => {
    if (!actions.hidden && !event.composedPath().includes(host)) reveal(false);
  };
  root.addEventListener("keydown", keys);
  document.addEventListener("pointerdown", outside, true);
  return () => {
    cancelOpen();
    root.removeEventListener("keydown", keys);
    document.removeEventListener("pointerdown", outside, true);
  };
}
