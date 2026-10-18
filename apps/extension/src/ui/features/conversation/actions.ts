import { api } from "../../../platform/api";
import type * as React from "react";
import { type SavedTask } from "../../../../../../packages/page-model";
import type { SessionView } from "../../../../../../packages/shared-types";
import { type UIPreferences } from "../../../../../../packages/ui/guidance";
import {
  appendMessage,
  clarificationReply,
  conversationCommand,
  explainStep,
  type ConversationMessage,
} from "../../../../../../packages/ui/presentation";
interface Context {
  setMessages: React.Dispatch<React.SetStateAction<ConversationMessage[]>>;
  view: SessionView | undefined;
  goal: string;
  preferences: UIPreferences;
  setGoal: (value: string) => void;
  command: (type: string, payload?: Record<string, unknown>) => Promise<void>;
  submitGoal: (saved?: SavedTask) => Promise<void>;
}
export function createConversationActions(context: Context) {
  const addMessage = async (
    role: "user" | "guide",
    text: string,
    id: string = crypto.randomUUID(),
  ) => {
    const message = { id, role, text: text.slice(0, 1500), at: Date.now() };
    context.setMessages((m) => appendMessage(m, message));
    await api.runtime.sendMessage({ type: "UI_APPEND", message });
  };
  const explainCurrentStep = async () => {
    await addMessage("guide", explainStep(context.view));
  };
  const submit = async () => {
    const text = context.goal.trim();
    if (!text) return;
    void addMessage("user", text);
    if (context.preferences.mode === "conversation") {
      const action = conversationCommand(text);
      if (action === "WHY") {
        await addMessage("guide", explainStep(context.view));
        context.setGoal("");
        return;
      }
      if (action) {
        await context.command(action);
        context.setGoal("");
        return;
      }
      const choice =
        context.view?.clarification &&
        clarificationReply(text, context.view.clarification.choices);
      if (choice) {
        await context.command("CLARIFY", { choice });
        context.setGoal("");
        return;
      }
      if (
        /^(?:what is|who is|tell me a joke|write me|explain quantum|what's the weather)/i.test(
          text,
        )
      ) {
        await addMessage(
          "guide",
          "I can guide website tasks and explain the selected step. Tell me where you want to go on this website.",
        );
        context.setGoal("");
        return;
      }
    }
    await context.submitGoal();
  };
  return { addMessage, explainCurrentStep, submit };
}
