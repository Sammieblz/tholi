import { api, browserTarget } from "./api";
import { hostPermissionPattern } from "./site-access";
import { serviceOrigin } from "../../../../packages/navigation-core/service-client";

function permissions(origin: string) {
  return {
    origins: [hostPermissionPattern(serviceOrigin(origin))],
    ...(browserTarget() === "firefox"
      ? { data_collection: ["authenticationInfo" as const] }
      : {}),
  };
}
/** Invoke directly from the panel's click, before awaiting any asynchronous work. */
export function requestServiceAuthAccess(origin: string) {
  return api.permissions.request(permissions(origin));
}
export async function hasServiceAuthAccess(origin: string) {
  try {
    return await api.permissions.contains(permissions(origin));
  } catch {
    return false;
  }
}
