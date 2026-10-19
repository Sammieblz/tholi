import { useEffect } from "react";
import { api } from "../../platform/api";
import type { SessionView } from "../../../../../packages/shared-types";
import { assistanceKind } from "../../../../../packages/safety-policy/assistance";

export function useAssistance(
  enabled: boolean,
  view?: SessionView,
  session?: { sessionId?: string; documentId?: string },
) {
  const control = view?.controls?.find((c) => c.id === view.selectedControlId);
  const task = view?.request?.tasks[view.request.active];
  const allowed = !!(
    enabled &&
    view?.status === "running" &&
    view.request?.status === "active" &&
    control &&
    assistanceKind(control, task)
  );
  useEffect(() => {
    if (
      !allowed ||
      !control ||
      !session?.sessionId ||
      !session.documentId ||
      !view?.page ||
      !view.request
    )
      return;
    const intent = {
      type: "UI_ASSIST_STEP",
      sessionId: session.sessionId,
      documentId: session.documentId,
      requestId: view.request.id,
      revision: view.page.revision,
      controlId: control.id,
    };
    const timer = setTimeout(() => {
      void api.runtime.sendMessage(intent).catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
  }, [
    allowed,
    session?.sessionId,
    session?.documentId,
    view?.request?.id,
    view?.page?.revision,
    control?.id,
  ]);
}
