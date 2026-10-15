import { useEffect } from "react";
import { Toast } from "@base-ui/react/toast";
import type { GuidanceProps } from "./types";

/** Only passive feedback belongs in a timed toast. Blocking prompts use attention. */
function NoticeViewport({ notice }: Pick<GuidanceProps, "notice">) {
  const { toasts, add, close } = Toast.useToastManager();
  useEffect(() => {
    if (!notice) return;
    const id = add({
      id: notice.id,
      title: notice.text,
      type: notice.tone || "info",
      priority: "low",
      timeout: 4000,
    });
    return () => close(id);
  }, [notice?.id, add, close]);
  return (
    <Toast.Viewport className="tholi-notice-stack">
      {toasts.map((toast) => (
        <Toast.Root key={toast.id} toast={toast} className="tholi-notice">
          <Toast.Content>
            <Toast.Title />
          </Toast.Content>
        </Toast.Root>
      ))}
    </Toast.Viewport>
  );
}
export function RoutineNotice(props: Pick<GuidanceProps, "notice">) {
  return (
    <Toast.Provider timeout={4000} limit={1}>
      <NoticeViewport {...props} />
    </Toast.Provider>
  );
}
