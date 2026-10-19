import type { PageControl, PageSnapshot } from "../page-model";

/** Compare destinations only with an actual live route, never a label alone. */
export function atDestination(control: PageControl, page: PageSnapshot) {
  if (
    !control.selected ||
    control.kind !== "navigation" ||
    !control.destination
  )
    return false;
  const path = (value: string) => value.replace(/\/$/, "") || "/";
  return (
    control.destination.origin === page.origin &&
    path(control.destination.path) === path(page.path)
  );
}

export function surfacePriority(control: PageControl) {
  const roles = control.structure?.regions.map((region) => region.role) || [];
  if (roles.some((role) => ["dialog", "menu", "listbox"].includes(role)))
    return 3;
  if (roles.some((role) => ["main", "article", "form"].includes(role)))
    return 2;
  if (
    roles.some((role) =>
      ["navigation", "banner", "complementary", "contentinfo"].includes(role),
    )
  )
    return 0;
  return 1;
}

/** Duplicate links to one destination are one decision, including menu/recents copies. */
export function sameControlDestination(a: PageControl, b: PageControl) {
  if ((a.reference?.frameId || 0) !== (b.reference?.frameId || 0)) return false;
  return (
    a.id === b.id ||
    !!(
      a.kind === "navigation" &&
      b.kind === "navigation" &&
      a.navigationKey &&
      a.navigationKey === b.navigationKey &&
      a.destination?.origin === b.destination?.origin
    )
  );
}
