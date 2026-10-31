import { useEffect, useRef, useState } from "react";
import type { useAccount } from "./session";
import { accountError } from "./account-error";

/** Private account actions share one cancellation and late-result boundary. */
export function useAccountOperation(account: ReturnType<typeof useAccount>) {
  const scope = JSON.stringify([
    account.session?.account.id,
    account.session?.account.workspaceId,
    account.session?.session.id,
  ]);
  const lifetime = useRef({
    scope,
    abort: new AbortController(),
    running: false,
  });
  const [state, setState] = useState({
    scope,
    busy: false,
    error: "",
    notice: "",
  });
  useEffect(() => {
    lifetime.current.abort.abort();
    const current = { scope, abort: new AbortController(), running: false };
    lifetime.current = current;
    setState({ scope, busy: false, error: "", notice: "" });
    return () => current.abort.abort();
  }, [scope]);
  const run = async <T>(
    work: (signal: AbortSignal) => Promise<T>,
    apply: (value: T) => void,
    notice = "",
  ) => {
    const current = lifetime.current;
    if (
      current.scope !== scope ||
      current.abort.signal.aborted ||
      current.running
    )
      return;
    current.running = true;
    setState({ scope, busy: true, error: "", notice: "" });
    try {
      const value = await work(current.abort.signal);
      if (current !== lifetime.current || current.abort.signal.aborted) return;
      apply(value);
      setState({ scope, busy: true, error: "", notice });
    } catch (error) {
      if (current === lifetime.current && !current.abort.signal.aborted)
        setState({ scope, busy: true, error: accountError(error), notice: "" });
    } finally {
      current.running = false;
      if (current === lifetime.current && !current.abort.signal.aborted)
        setState((previous) => ({ ...previous, busy: false }));
    }
  };
  const visible =
    state.scope === scope ? state : { busy: false, error: "", notice: "" };
  return {
    busy: visible.busy,
    error: visible.error,
    notice: visible.notice,
    run,
  };
}
