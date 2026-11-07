import { api, type Runtime } from "../platform/api";
import {
  getPrivateSetting,
  setPrivateSetting,
} from "../platform/private-settings";
import {
  cancelPendingServiceSignIn,
  serviceAuthCommand,
  servicePlanCatalog,
  activateSetupPlan,
} from "../platform/service-auth";
import { serviceAuthStatusSchema } from "../platform/service-auth-contract";
import {
  setupStateSchema,
  setupCommandSchema,
  type SetupState,
} from "../platform/setup-contract";

let writes = Promise.resolve();
let selection = 0;
function serialize<T>(operation: () => Promise<T>) {
  const result = writes.catch(() => {}).then(operation);
  writes = result.then(
    () => {},
    () => {},
  );
  return result;
}
export function isWelcome(sender: Runtime.MessageSender) {
  return (
    sender.id === api.runtime.id &&
    sender.url === api.runtime.getURL("welcome.html") &&
    sender.frameId === 0
  );
}
export async function setupStatus(): Promise<SetupState> {
  const value = await getPrivateSetting("first-run");
  // Missing records belong to retained installations, never a forced new tutorial.
  if (value === undefined) return { version: 1, complete: true, step: 1 };
  return setupStateSchema.parse(value);
}
async function openWelcome() {
  const url = api.runtime.getURL("welcome.html");
  const existing = (await api.tabs.query({})).find((tab) => tab.url === url);
  if (existing?.id !== undefined) {
    await api.tabs.update(existing.id, { active: true });
    if (existing.windowId !== undefined)
      await api.windows.update(existing.windowId, { focused: true });
  } else await api.tabs.create({ url });
}
export function setupInstalled(reason: string) {
  if (reason !== "install") return Promise.resolve();
  return serialize(async () => {
    if ((await getPrivateSetting("first-run")) !== undefined) return;
    await setPrivateSetting("first-run", {
      version: 1,
      complete: false,
      step: 1,
    });
    // Persist before opening: worker restarts and failed tab creation cannot repeat it.
    await openWelcome();
  });
}
export async function setupCommand(raw: unknown) {
  const command = setupCommandSchema.parse(raw);
  if (command.type === "SETUP_STATUS") return setupStatus();
  if (command.type === "SETUP_PLANS")
    return { catalog: await servicePlanCatalog() };
  if (command.type === "SETUP_OPEN") {
    return serialize(async () => {
      await openWelcome();
      return { ok: true };
    });
  }
  const operation =
    command.type === "SETUP_SELECT" ||
    (command.type === "SETUP_COMPLETE" && command.choice === "local")
      ? ++selection
      : selection;
  if (
    command.type === "SETUP_SELECT" ||
    (command.type === "SETUP_COMPLETE" && command.choice === "local")
  ) {
    cancelPendingServiceSignIn();
    await serviceAuthCommand({
      type: "AUTH_INFERENCE_CONFIGURE",
      profile: "fake",
      enabled: false,
      images: false,
    });
  }
  return serialize(async () => {
    const current = await setupStatus();
    const check = () => {
      if (selection !== operation) throw Error("The setup choice changed.");
    };
    check();
    if (command.type === "SETUP_SELECT") {
      const next = {
        ...current,
        complete: false,
        planIntent: command.planIntent,
      };
      await setPrivateSetting("first-run", next);
      return next;
    }
    if (command.type === "SETUP_ACTIVATE") {
      if (current.planIntent?.mode !== "free-cloud")
        throw Error("Choose Free Cloud before enabling it.");
      await activateSetupPlan(current.planIntent, command.images, check);
      check();
      const next: SetupState = {
        ...current,
        complete: true,
        choice: "account",
      };
      await setPrivateSetting("first-run", next);
      return next;
    }
    if (command.type === "SETUP_COMPLETE") {
      if (command.choice === "account") {
        const status = serviceAuthStatusSchema.parse(
          await serviceAuthCommand({ type: "AUTH_STATUS" }),
        );
        if (!status.account)
          throw Error("Complete sign-in before account setup.");
        check();
        if (current.planIntent && current.planIntent.mode !== "local")
          throw Error(
            "Review the selected plan and processing consent before finishing setup.",
          );
      }
      const next: SetupState = {
        ...current,
        complete: true,
        choice: command.choice,
        ...(command.choice === "local"
          ? { planIntent: { mode: "local" as const } }
          : {}),
      };
      await setPrivateSetting("first-run", next);
      return next;
    }
    const next = { ...current, step: command.step };
    await setPrivateSetting("first-run", next);
    return next;
  });
}
