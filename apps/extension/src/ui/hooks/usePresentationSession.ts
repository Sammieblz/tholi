import { useCallback, useEffect, useRef, useState } from "react";
import {
  defaultPreferences,
  type UIPreferences,
} from "../../../../../packages/ui/guidance";
import { type ConversationMessage } from "../../../../../packages/ui/presentation";

export function usePresentationSession(widget: boolean, onReset: () => void) {
  const resetRef = useRef(onReset);
  resetRef.current = onReset;
  const [preferences, setPreferences] =
    useState<UIPreferences>(defaultPreferences);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const hydratedRef = useRef(false);
  const preferencesPending = useRef(false);
  const lastSurface = useRef<"sidebar" | "widget" | undefined>(undefined);
  const [goal, restoreGoal] = useState("");
  const goalValue = useRef("");
  const goalRevision = useRef(0);
  const savedGoalRevision = useRef(0);
  const setGoal = useCallback((value: string) => {
    if (value !== goalValue.current) goalRevision.current++;
    goalValue.current = value;
    restoreGoal(value);
  }, []);
  useEffect(() => {
    let current = true;
    let sequence = 0;
    let applied = 0;
    const refresh = () => {
      const read = ++sequence;
      const draftRevision = goalRevision.current;
      const draftClean = draftRevision === savedGoalRevision.current;
      void chrome.runtime
        .sendMessage({ type: "UI_GET" })
        .then((r) => {
          if (!current || read < applied || r.error) return;
          applied = read;
          if (!preferencesPending.current) setPreferences(r.preferences);
          setMessages(r.messages);
          const becomingVisible =
            lastSurface.current !== r.preferences.surface &&
            r.preferences.surface === (widget ? "widget" : "sidebar");
          lastSurface.current = r.preferences.surface;
          // Handoffs hydrate the destination without overwriting active typing.
          if (!hydratedRef.current || becomingVisible) {
            if (draftClean && goalRevision.current === draftRevision) {
              goalValue.current = r.draft;
              restoreGoal(r.draft);
            }
            hydratedRef.current = true;
            setHydrated(true);
          }
        })
        .catch(() => {});
    };
    refresh();
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "session" && changes.tholiSessionReset) {
        resetRef.current();
        setGoal("");
        setMessages([]);
      }
      if (
        (area === "session" &&
          (changes.tholiConversation ||
            changes.tholiDraft ||
            changes.tholiSurfacePresentation ||
            changes.tholiSessionReset)) ||
        (area === "local" && changes.tholiPreferences)
      )
        refresh();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      current = false;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    const revision = goalRevision.current;
    const id = setTimeout(
      () =>
        void chrome.runtime
          .sendMessage({ type: "UI_SAVE", draft: goal })
          .then((reply) => {
            if (!reply?.error && goalRevision.current === revision)
              savedGoalRevision.current = revision;
          })
          .catch(() => {}),
      200,
    );
    return () => clearTimeout(id);
  }, [goal, hydrated]);
  return {
    preferences,
    setPreferences,
    messages,
    setMessages,
    hydrated,
    goal,
    setGoal,
    preferencesPending,
  };
}
