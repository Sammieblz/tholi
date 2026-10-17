import { useEffect, useRef, useState } from "react";
import type { UIPreferences } from "../../../../../packages/ui/guidance/types";
import {
  conversationCommand,
  type ConversationMessage,
  type GuidancePresentation,
} from "../../../../../packages/ui/presentation";
import { usePreferences } from "../preferences";
import { goals, initialPreferences, type Task } from "./practice";
export function usePracticeAdapter({
  mode,
  onModeChange,
  onDone,
}: {
  mode?: UIPreferences["mode"];
  onModeChange?: (mode: UIPreferences["mode"]) => void;
  onDone?: () => void;
}) {
  const { theme, trackEvent } = usePreferences();
  const [shadow, setShadow] = useState<ShadowRoot | null>(null);
  const [preferences, setPreferences] = useState(initialPreferences);
  const [draft, setDraft] = useState(goals.settings);
  const [task, setTask] = useState<Task>();
  const [screen, setScreen] = useState<"overview" | "settings">("overview");
  const [menu, setMenu] = useState(false);
  const [languageMenu, setLanguageMenu] = useState(false);
  const [language, setLanguage] = useState("English");
  const [selection, setSelection] = useState("English");
  const [paused, setPaused] = useState(false);
  const [complete, setComplete] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [verifiedPath, setVerifiedPath] = useState<string[]>([]);
  const [motionActive, setMotionActive] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const id = useRef(0),
    lastStep = useRef("");
  const append = (role: ConversationMessage["role"], text: string) =>
    setMessages((previous) =>
      [
        ...previous,
        { id: `sample-${++id.current}`, role, text, at: Date.now() },
      ].slice(-40),
    );
  useEffect(() => {
    if (mode) setPreferences((previous) => ({ ...previous, mode }));
  }, [mode]);
  useEffect(() => {
    let inView = false;
    const update = () =>
      setMotionActive(inView && document.visibilityState !== "hidden");
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      update();
    });
    if (container.current) observer.observe(container.current);
    document.addEventListener("visibilitychange", update);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  useEffect(() => {
    if (!task || paused || complete) return;
    if (
      (task === "settings" && screen === "settings") ||
      (task === "spanish" && language === "Español")
    ) {
      setComplete(true);
      trackEvent({
        name: "practice_complete",
        practice:
          task === "settings" ? "account-settings" : "language-preference",
      });
      onDone?.();
    }
  }, [task, paused, complete, screen, language, onDone]);
  const active = !!task && !complete;
  const recordStep = (label: string) => {
    if (active && !paused) setVerifiedPath((path) => [...path, label]);
  };
  const nextSteps =
    task && !complete
      ? [
          ...(screen === "overview"
            ? [...(!menu ? ["Open account menu"] : []), "Account settings"]
            : []),
          ...(task === "spanish"
            ? selection === "Español"
              ? ["Save changes"]
              : [
                  ...(!languageMenu ? ["Open Language"] : []),
                  "Choose Español",
                  "Save changes",
                ]
            : []),
        ]
      : [];
  let instruction =
    "Choose a sample destination, then use the highlighted controls in the practice website.";
  let phase: GuidancePresentation["phase"] = "idle";
  if (unsupported) {
    phase = "clarification";
    instruction =
      "This practice website supports account settings and changing the language to Spanish. Choose one of those destinations below.";
  } else if (task) {
    phase = complete ? "arrived" : paused ? "paused" : "guiding";
    instruction = complete
      ? task === "spanish"
        ? "The saved language is Español. Your requested change is verified in this sample website."
        : "Account settings are open. Your destination is verified in this sample website."
      : paused
        ? "Your destination is saved. Resume when you are ready to continue."
        : screen !== "settings"
          ? menu
            ? "Choose Account settings in the open account menu."
            : "Open the Account menu in the practice website."
          : !languageMenu
            ? selection === "Español"
              ? "Select Save changes to apply the language you chose."
              : "Open the Language control in account settings."
            : "Choose Español from the available languages.";
  }
  const presentation: GuidancePresentation = {
    phase,
    stepId: `practice:${task || "idle"}:${phase}:${screen}:${menu}:${languageMenu}:${selection}`,
    title: complete
      ? "Arrived"
      : paused
        ? "Paused"
        : unsupported
          ? "Choose a practice destination"
          : task
            ? "Your next step"
            : "Meet your guide",
    instruction,
    destination: task ? goals[task] : undefined,
    warning: unsupported,
    busy: false,
  };
  useEffect(() => {
    if (lastStep.current === presentation.stepId || !task) return;
    lastStep.current = presentation.stepId;
    append("guide", instruction);
  }, [presentation.stepId, task, instruction]);
  const command = (type: string) => {
    if (type === "PAUSE") setPaused(true);
    if (type === "RESUME") setPaused(false);
    if (type === "STOP") {
      setTask(undefined);
      setPaused(false);
      setComplete(false);
      setUnsupported(false);
      append(
        "guide",
        "Practice guidance stopped. Your conversation is still here.",
      );
    }
  };
  const start = (value: string) => {
    if (!value.trim()) return;
    append("user", value.trim());
    const parsed = conversationCommand(value);
    if (parsed === "WHY") {
      append(
        "guide",
        task
          ? "This step points to a visible control in the sample website. Arrival is checked against the open settings screen or the saved language, not the click alone."
          : "Choose a destination first. This is a local, controlled demonstration, not a general question answering assistant.",
      );
      setDraft("");
      return;
    }
    if (parsed) {
      command(parsed);
      setDraft("");
      return;
    }
    const excluded = /\b(?:don't|do not|never|without|avoid|not)\b/i.test(
      value,
    );
    const languageRequest = /language|spanish|espa[nñ]ol|french|german/i.test(
      value,
    );
    const next = excluded
      ? undefined
      : languageRequest
        ? /spanish|espa[nñ]ol/i.test(value)
          ? "spanish"
          : undefined
        : /account|settings|profile/i.test(value)
          ? "settings"
          : undefined;
    setTask(next);
    if (next)
      trackEvent({
        name: "practice_start",
        practice:
          next === "settings" ? "account-settings" : "language-preference",
      });
    setVerifiedPath([]);
    setUnsupported(!next);
    setComplete(false);
    setPaused(false);
    setDraft("");
  };
  const reset = () => {
    setTask(undefined);
    setScreen("overview");
    setMenu(false);
    setLanguageMenu(false);
    setLanguage("English");
    setSelection("English");
    setComplete(false);
    setPaused(false);
    setUnsupported(false);
    setDraft(goals.settings);
    setMessages([]);
    setVerifiedPath([]);
    lastStep.current = "";
  };
  const highlighted = active && !paused;

  return {
    container,
    motionActive,
    start,
    menu,
    setMenu,
    recordStep,
    highlighted,
    screen,
    setScreen,
    language,
    languageMenu,
    setLanguageMenu,
    selection,
    task,
    setSelection,
    setLanguage,
    theme,
    setShadow,
    shadow,
    presentation,
    preferences,
    setPreferences,
    draft,
    setDraft,
    messages,
    active,
    paused,
    command,
    setTask,
    setComplete,
    setUnsupported,
    setPaused,
    onModeChange,
    verifiedPath,
    unsupported,
    nextSteps,
    complete,
    reset,
  };
}
