import { serviceOrigin } from "../../../../packages/navigation-core/service-client";

declare const __THOLI_SERVICE_ORIGIN__: string;
/** Public deployment configuration only, never credentials or an automatic opt-in. */
export const defaultAccountOrigin =
  typeof __THOLI_SERVICE_ORIGIN__ !== "undefined" &&
  __THOLI_SERVICE_ORIGIN__.trim()
    ? serviceOrigin(__THOLI_SERVICE_ORIGIN__)
    : undefined;
