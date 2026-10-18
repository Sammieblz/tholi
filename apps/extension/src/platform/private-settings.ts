import { api, browserTarget, chromiumApi } from "./api";
let database: Promise<IDBDatabase> | undefined;
let protectedLocal: Promise<void> | undefined;
export function protectLocalSettings() {
  if (browserTarget() === "firefox") return Promise.resolve();
  return (protectedLocal ||= (async () => {
    const area = chromiumApi()?.storage?.local;
    if (!area?.setAccessLevel)
      throw Error(
        "Tholi requires Chromium 140 or newer for protected settings.",
      );
    await area.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  })());
}
function db() {
  return (database ||= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("tholi-private-settings", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("settings");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      database = undefined;
      reject(request.error);
    };
  }));
}
export async function getPrivateSetting<T>(
  key: "backend" | "vision",
): Promise<T | undefined> {
  if (browserTarget() === "chromium") {
    await protectLocalSettings();
    return (await api.storage.local.get(key))[key] as T | undefined;
  }
  const store = await db();
  return new Promise((resolve, reject) => {
    const tx = store.transaction("settings", "readonly"),
      request = tx.objectStore("settings").get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}
export async function setPrivateSetting(
  key: "backend" | "vision",
  value: unknown,
) {
  if (browserTarget() === "chromium") {
    await protectLocalSettings();
    await api.storage.local.set({ [key]: value });
    return;
  }
  const store = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = store.transaction("settings", "readwrite");
    tx.objectStore("settings").put(value, key);
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
}
