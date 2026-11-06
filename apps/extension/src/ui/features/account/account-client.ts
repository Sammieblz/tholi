import { api } from "../../../platform/api";
import { requestServiceAuthAccess } from "../../../platform/service-auth-access";

export async function accountRpc(message: unknown): Promise<unknown> {
  const result: unknown = await api.runtime.sendMessage(message);
  if (result && typeof result === "object" && "error" in result)
    throw new Error(
      "The account request could not be completed. Check your service origin and account permissions, then try again.",
    );
  return result;
}

/** Call from the click: Firefox authentication consent must precede the first await. */
export function beginAccountAuthentication(
  origin: string,
  action: "signin" | "signup",
  configure = false,
  current: () => boolean = () => true,
) {
  const access = requestServiceAuthAccess(origin);
  return (async () => {
    if (!(await access))
      throw new Error(
        "Account access was declined. Local guidance is still available.",
      );
    if (!current()) throw new Error("The account choice changed.");
    if (configure) await accountRpc({ type: "AUTH_CONFIGURE", origin });
    if (!current()) throw new Error("The account choice changed.");
    return accountRpc({ type: "AUTH_SIGN_IN", action });
  })();
}
