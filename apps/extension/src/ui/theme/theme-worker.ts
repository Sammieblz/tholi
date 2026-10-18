import { api, type Runtime, type Tabs } from "../../platform/api";
import type { Theme } from "../../../../../packages/ui/page-theme";
/** Permission-scoped, top-document handshake. Never reads an inaccessible site. */
export async function tabAppearance(tab: Tabs.Tab): Promise<Theme | undefined> {
  if (tab.id === undefined || !/^https?:/.test(tab.url || "")) return;
  try {
    const frame = await api.webNavigation.getFrame({
      tabId: tab.id,
      frameId: 0,
    });
    if (!frame?.documentId) return;
    const read = () =>
      api.tabs.sendMessage(
        tab.id!,
        { type: "READ_PAGE_THEME" },
        { documentId: frame.documentId },
      );
    let result;
    try {
      result = await read();
    } catch {
      await api.scripting.executeScript({
        target: { tabId: tab.id, documentIds: [frame.documentId] },
        files: ["theme-page.js"],
      });
      result = await read();
    }
    if (result?.theme === "light" || result?.theme === "dark")
      return result.theme;
  } catch {
    /* Access recovery uses the system palette until a fresh handshake. */
  }
}
export async function validThemeSender(sender: Runtime.MessageSender) {
  if (
    sender.id !== api.runtime.id ||
    sender.frameId !== 0 ||
    !sender.documentId ||
    sender.tab?.id === undefined
  )
    return false;
  const frame = await api.webNavigation
    .getFrame({ tabId: sender.tab.id, frameId: 0 })
    .catch(() => undefined);
  return frame?.documentId === sender.documentId;
}
