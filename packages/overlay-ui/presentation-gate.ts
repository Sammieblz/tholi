// Presentation visibility is independent of observation and task verification.
// Each authorized frame receives the same value from the worker.
let visible = true;
const listeners = new Set<(visible: boolean) => void>();
export function guidanceVisible() {
  return visible;
}
export function setGuidanceVisible(next: boolean) {
  if (next === visible) return;
  visible = next;
  for (const listener of [...listeners]) listener(next);
}
export function onGuidanceVisibility(listener: (visible: boolean) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
