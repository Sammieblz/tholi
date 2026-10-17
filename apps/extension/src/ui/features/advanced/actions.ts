import type * as React from "react";
import { LocalModel } from "../../../inference/browser-language-model";
interface Context {
  setError: React.Dispatch<React.SetStateAction<string>>;
  setAiProgress: React.Dispatch<React.SetStateAction<number | undefined>>;
  model: React.RefObject<LocalModel>;
  setAiEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setAiAvailability: React.Dispatch<React.SetStateAction<string>>;
}
export function createModelActions(context: Context) {
  const enableAI = async () => {
    context.setError("");
    context.setAiProgress(0);
    try {
      await context.model.current.enable(context.setAiProgress);
      context.setAiEnabled(true);
      context.setAiAvailability("available");
    } catch (error) {
      context.setError(
        error instanceof Error
          ? error.message
          : "On-device AI could not start.",
      );
    } finally {
      context.setAiProgress(undefined);
    }
  };
  return { enableAI };
}
