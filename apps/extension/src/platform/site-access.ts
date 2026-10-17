/** Read the active tab at the click, rather than a previously polled panel state. */
export function requestCurrentSiteAccess(expectedOrigin?: string) {
  return new Promise<{ tabId: number; origin: string }>((resolve, reject) => {
    // Keep the permission call inside the Chrome API callback from the user
    // gesture; do not await a network request or a planner before requesting it.
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      const tab = tabs[0];
      let url: URL;
      try {
        url = new URL(tab?.url || "");
        if (
          tab?.id === undefined ||
          !["http:", "https:"].includes(url.protocol)
        )
          throw new Error("Open an HTTP or HTTPS website tab first.");
        if (expectedOrigin && expectedOrigin !== url.origin)
          throw new Error(
            "Return to the expected task destination before continuing.",
          );
      } catch (error) {
        reject(
          error instanceof Error
            ? error
            : new Error("The current tab is unavailable."),
        );
        return;
      }
      chrome.permissions
        .request({
          origins: [url.protocol + "//" + url.hostname + "/*"],
        })
        .then((granted) => {
          if (!granted) {
            reject(
              new Error(
                "Website access was declined. Grant access to this website to start discovery.",
              ),
            );
            return;
          }
          resolve({ tabId: tab.id!, origin: url.origin });
        }, reject);
    });
  });
}
