import { embeddedControlsHtml } from "../../../fixtures/multi-app/frame-html";
import backendDataPermissions from "../../../../config/backend-data-permissions.json" with { type: "json" };
import firefox from "selenium-webdriver/firefox.js";
import { test, expect } from "../../../support/browser-test";
import { openFirefoxExtension } from "../../../support/firefox-extension";
import { verifyWebDriverSurfaces } from "../../../support/webdriver-surfaces";
import { acceptanceServer } from "../../../support/fixture-server";
import type { CaptureMetadata } from "../../../../packages/vision/contracts";

test.use({ trace: "off", screenshot: "off", video: "off" });
test("Firefox uses native document identity, local planning and independently verified outcomes", async ({}, info) => {
  const fixture = await acceptanceServer();
  let app: Awaited<ReturnType<typeof openFirefoxExtension>> | undefined;
  try {
    app = await openFirefoxExtension(fixture.url);
    const current = app;
    await info.attach("browser-runtime", {
      body: Buffer.from(
        JSON.stringify({
          name: "firefox",
          version: app.version,
          target: "firefox",
        }),
      ),
      contentType: "application/json",
    });
    const started = await app.start();
    expect(started.documentId).toBeTruthy();
    const observation = await app.extension(async () => {
      const api = (globalThis as any).browser;
      const result = await api.runtime.sendMessage({ type: "GET_PAGE" });
      const session = await api.runtime.sendMessage({ type: "GET_SESSION" });
      return {
        result,
        session,
        tab: await api.tabs.get(session.tabId),
        zoom: await api.tabs.getZoom(session.tabId),
      };
    });
    expect(observation.result.error).toBeUndefined();
    expect(observation.result.perception.native).toMatchObject({
      frameId: 0,
      tabId: observation.session.tabId,
      documentId: started.documentId,
      windowId: observation.tab.windowId,
    });
    expect(observation.result.perception.pageRevision).toBe(
      observation.result.page.revision,
    );
    expect(observation.result.perception.frames[0].viewport.browserZoom).toBe(
      observation.zoom,
    );
    expect(observation.session.view).not.toHaveProperty("perception");
    const first = await app.goal("Make text larger");
    expect(first.view.goalPlan.status).toBe("guiding");
    expect(
      first.view.page.controls.find(
        (c: any) => c.id === first.view.selectedControlId,
      )?.label,
    ).toMatch(/Appearance|Large/);
    expect(first.view.goalPlan.status).not.toBe("completed");
    await app.site(() => document.title);
    await app.driver.findElement({ css: "summary" }).click();
    await app.driver.findElement({ css: "#large" }).click();
    await app.waitFor(
      () => current.view(),
      (view) => view.goalPlan?.status === "completed",
      "Actual selection is verified",
    );
    expect(
      await app.site(
        () => (document.querySelector("#large") as HTMLInputElement).checked,
      ),
    ).toBe(true);
    await app.site(() => {
      document.querySelector("details")!.open = false;
    });
    await app.extension(async () => {
      const api = (globalThis as any).browser;
      const { tholiPreferences } =
        await api.storage.local.get("tholiPreferences");
      const reply = await api.runtime.sendMessage({
        type: "UI_SAVE",
        preferences: {
          mode: "guide",
          surface: "sidebar",
          advanced: false,
          ...tholiPreferences,
          assisted: true,
        },
      });
      if (reply?.error) throw Error(reply.error);
    });
    await app.goal("Show appearance");
    await app.waitFor(
      () => current.site(() => document.querySelector("details")!.open),
      (open) => open === true,
      "Opt-in assistance opens a real Firefox disclosure",
    );
    await app.extension(async () => {
      const api = (globalThis as any).browser;
      const { tholiPreferences } =
        await api.storage.local.get("tholiPreferences");
      await api.runtime.sendMessage({
        type: "UI_SAVE",
        preferences: { ...tholiPreferences, assisted: false },
      });
    });
    await app.goal("Delete account");
    const boundary = await app.view();
    expect(boundary.goalPlan.status).not.toBe("completed");
    expect(boundary.selectedControlId).toBeUndefined();
    expect(boundary.goalPlan.status).toBe("unresolved");
    expect(boundary.goalPlan.issue).toBe("consequential");
    const surfaces = await verifyWebDriverSurfaces(app, "firefox");
    await info.attach("native-surfaces", {
      body: Buffer.from(JSON.stringify(surfaces)),
      contentType: "application/json",
    });
    const capture = await app.extension(async (tabId: number) => {
      const api = (globalThis as any).browser;
      const session = await api.runtime.sendMessage({ type: "GET_SESSION" });
      const captureId = crypto.randomUUID();
      let metadata: CaptureMetadata;
      let image: string;
      let browserZoom: number;
      try {
        const prepared = await api.tabs.sendMessage(
          tabId,
          { type: "PREPARE_CAPTURE", sessionId: session.sessionId, captureId },
          { frameId: 0 },
        );
        if (prepared?.error || !prepared?.metadata)
          throw Error("Current Firefox capture metadata unavailable");
        metadata = prepared.metadata;
        browserZoom = await api.tabs.getZoom(tabId);
        image = await api.tabs.captureVisibleTab(
          (await api.tabs.get(tabId)).windowId,
          { format: "png" },
        );
        const checked = await api.tabs.sendMessage(
          tabId,
          { type: "CHECK_CAPTURE", sessionId: session.sessionId, captureId },
          { frameId: 0 },
        );
        if (!checked?.current) throw Error("Firefox capture was invalidated");
      } finally {
        await api.tabs.sendMessage(
          tabId,
          { type: "RESTORE_CAPTURE", sessionId: session.sessionId, captureId },
          { frameId: 0 },
        );
      }
      const worker = new Worker(api.runtime.getURL("ocr-worker.js"), {
        type: "module",
      });
      try {
        const id = crypto.randomUUID();
        const result: any = await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(Error("Masked capture OCR deadline")),
            30000,
          );
          worker.onerror = (event) => {
            clearTimeout(timer);
            reject(Error(event.message));
          };
          worker.onmessage = ({ data }) => {
            if (data.id === id) {
              clearTimeout(timer);
              data.error ? reject(Error(data.error)) : resolve(data.value);
            }
          };
          worker.postMessage({
            type: "OCR_REQUEST",
            id,
            image,
            metadata,
            browserZoom,
            captureCssBounds: {
              x: 0,
              y: 0,
              width: metadata.viewport.width,
              height: metadata.viewport.height,
            },
            stamp: {
              requestId: session.view.request.id,
              journeyId: session.view.journey.id,
              contextRevision: session.view.journey.workflow?.revision || 0,
              documentId: session.documentId,
              observationRevision: metadata.observationRevision,
              viewportRevision: metadata.viewportRevision,
              captureId,
            },
          });
        });
        return {
          metadata,
          png: image.startsWith("data:image/png;base64,"),
          leaked: JSON.stringify(result).includes("SENTINEL"),
        };
      } finally {
        worker.terminate();
      }
    }, app.tabId);
    expect(capture.png).toBe(true);
    expect(capture.metadata.masks.length).toBeGreaterThan(0);
    expect(JSON.stringify(capture)).not.toContain("SENTINEL");
    expect(capture.leaked).toBe(false);
    await info.attach("firefox-masked-capture", {
      body: Buffer.from(
        JSON.stringify({
          maskedRegions: capture.metadata.masks.length,
          png: true,
          noPrivateOcrText: true,
        }),
      ),
      contentType: "application/json",
    });
    await app.message({ type: "STOP" });
    expect((await app.view()).status).toBe("stopped");
  } catch (error) {
    if (app) {
      const failed = await app.view().catch(() => undefined);
      await info.attach("firefox-session-failure", {
        body: Buffer.from(
          JSON.stringify({
            status: failed?.status,
            controls: failed?.page?.controls?.length ?? null,
            verifiedSteps: failed?.verifiedSteps ?? null,
          }),
        ),
        contentType: "application/json",
      });
    }
    throw error;
  } finally {
    await app?.close();
    await fixture.close();
  }
});

test("Firefox event-page restart protects settings and rebinds native documents and frames", async ({}, info) => {
  const fixture = await acceptanceServer({
    "/frame-host":
      '<h1>Workspace</h1><iframe title="Embedded application" src="/embedded-controls" style="width:650px;height:300px;border:0"></iframe><iframe title="Ungranted application" id="private-frame"></iframe><script>document.querySelector("#private-frame").src="http://localhost:"+location.port+"/private-controls"</script>',
    "/embedded-controls": embeddedControlsHtml,
    "/private-controls": '<input aria-label="Private embedded field">',
  });
  let app: Awaited<ReturnType<typeof openFirefoxExtension>> | undefined;
  try {
    app = await openFirefoxExtension(fixture.url);
    await app.start();
    await app.goal("Show search");
    const before = await app.message({ type: "GET_SESSION" });
    await app.message({ type: "PAUSE" });
    await app.message({
      type: "UI_SAVE",
      draft: "Retained after event-page suspension",
    });
    const settings = {
      url: "http://127.0.0.1:8787",
      token: "SYNTHETIC_PRIVATE_TOKEN_FOR_ISOLATION",
      enabled: false,
    };
    expect(
      (await app.message({ type: "SET_BACKEND", ...settings })).error,
    ).toBeUndefined();
    const dataConsent = await app.extension(async () => {
      const api = (globalThis as any).browser;
      const declared =
        api.runtime.getManifest().browser_specific_settings.gecko
          .data_collection_permissions;
      return {
        declared,
        granted: await api.permissions.contains({
          data_collection: declared.optional,
        }),
      };
    });
    expect(dataConsent.declared).toMatchObject({
      required: ["none"],
      optional: backendDataPermissions,
      has_previous_consent: false,
    });
    expect(dataConsent.granted).toBe(false);
    expect(
      (await app.message({ type: "SET_BACKEND", ...settings, enabled: true }))
        .error,
    ).toMatch(/data transmission/i);
    const isolation = await app.extension(async (tabId: number) => {
      const api = (globalThis as any).browser;
      const local = await api.storage.local.get(null);
      const [content] = await api.scripting.executeScript({
        target: { tabId },
        func: async () => {
          const api = (globalThis as any).browser;
          const local = await api.storage.local.get(null);
          const denied = await api.runtime.sendMessage({ type: "GET_BACKEND" });
          let sessionKeys: string[] = [];
          try {
            sessionKeys = Object.keys(await api.storage.session.get(null));
          } catch {
            /* Firefox keeps session storage privileged. */
          }
          return {
            local,
            denied,
            sessionKeys,
            databases: (await indexedDB.databases()).map(
              (entry: any) => entry.name,
            ),
          };
        },
      });
      return { local, content: content.result };
    }, app.tabId);
    expect(JSON.stringify(isolation)).not.toContain(settings.token);
    expect(isolation.content.denied.error).toMatch(/panel/i);
    expect(isolation.content.sessionKeys).toEqual([]);
    expect(isolation.content.databases).not.toContain("tholi-private-settings");
    const knowledgeBefore = await app.message({ type: "GET_MEMORY" });
    expect(knowledgeBefore.memory.pages.length).toBeGreaterThan(0);
    await app.driver.switchTo().window(app.panel);
    const panelUrl = await app.driver.getCurrentUrl();
    await app.driver.get("about:blank");
    await app.driver.setContext(firefox.Context.CHROME);
    const lifecycle = await app.driver.executeScript(async () => {
      const extension = (globalThis as any).WebExtensionPolicy.getByID(
        "tholi@ilunonsen.com",
      ).extension;
      const before = extension.backgroundState;
      await extension.terminateBackground({ disableResetIdleForTest: true });
      return { before, after: extension.backgroundState };
    });
    expect(lifecycle).toEqual({ before: "running", after: "stopped" });
    await app.driver.executeScript((url: string) => {
      const scope = globalThis as any;
      const blank = Array.from(scope.gBrowser.tabs).find(
        (tab: any) => tab.linkedBrowser.currentURI.spec === "about:blank",
      ) as any;
      if (!blank) throw Error("Suspended extension view tab missing");
      scope.gBrowser.selectedTab = blank;
      blank.linkedBrowser.loadURI(scope.Services.io.newURI(url), {
        triggeringPrincipal:
          scope.Services.scriptSecurityManager.getSystemPrincipal(),
      });
    }, panelUrl);
    await app.driver.setContext(firefox.Context.CONTENT);
    const current = app;
    await app.waitFor(
      () => app!.driver.getCurrentUrl(),
      (url) => url === panelUrl,
      "Extension view restored after suspension",
    );
    const after = await current.message({ type: "GET_SESSION" });
    expect(after.sessionId).toBe(before.sessionId);
    expect(after.documentId).toBe(before.documentId);
    expect(after.view.request.id).toBe(before.view.request.id);
    expect(after.view.status).toBe("paused");
    expect((await current.message({ type: "UI_GET" })).draft).toBe(
      "Retained after event-page suspension",
    );
    expect(await current.message({ type: "GET_BACKEND" })).toEqual(settings);
    await app.driver.switchTo().window(app.website);
    expect(
      (await current.message({ type: "GET_MEMORY" })).memory.pages,
    ).toHaveLength(knowledgeBefore.memory.pages.length);
    await app.driver.switchTo().window(app.website);
    await current.message({ type: "RESUME" });
    expect((await current.goal("Show languages")).view.goalPlan.status).toBe(
      "guiding",
    );
    const previousDocument = (await current.message({ type: "GET_SESSION" }))
      .documentId;
    expect(
      await current.extension(() =>
        (globalThis as any).browser.permissions.remove({
          origins: ["http://localhost/*"],
        }),
      ),
    ).toBe(true);
    await current.message({ type: "PAUSE" });
    await current.visit(new URL("/frame-host", fixture.url).href);
    await current.waitFor(
      () => current.view(),
      (view) => view.status === "paused",
      "Explicit Pause survives the full document transition",
    );
    expect((await current.message({ type: "RESUME" })).error).toBeUndefined();
    await current.waitFor(
      () => current.view(),
      (view) =>
        view.controls?.some(
          (control: any) =>
            control.label === "Embedded search" &&
            control.reference?.frameId > 0,
        ),
      "Firefox exposes only a freshly authorized frame document",
    );
    const framed = await current.message({ type: "GET_SESSION" });
    expect(framed.documentId).not.toBe(previousDocument);
    const blockedOrigin = new URL(fixture.url);
    blockedOrigin.hostname = "localhost";
    expect(framed.view.frameAccess).toContain(blockedOrigin.origin);
    expect(JSON.stringify(framed.view.controls)).not.toContain(
      "Private embedded field",
    );
    const frameControl = framed.view.controls.find(
      (control: any) => control.label === "Embedded search",
    );
    expect(frameControl.reference.documentId).toBeTruthy();
    expect(frameControl.reference.documentId).not.toBe(framed.documentId);
    await current.goal("Find embedded search");
    await current.driver.switchTo().frame(
      await current.driver.findElement({
        css: 'iframe[title="Embedded application"]',
      }),
    );
    await current.driver
      .findElement({ css: 'input[aria-label="Embedded search"]' })
      .click();
    expect(
      await current.driver.executeScript(() =>
        document.activeElement?.getAttribute("aria-label"),
      ),
    ).toBe("Embedded search");
    await current.driver.switchTo().defaultContent();
    await current.waitFor(
      () => current.view(),
      (view) => view.goalPlan?.status === "completed",
      "Frame-local focus is independently verified",
    );
    await info.attach("event-page-recovery", {
      body: Buffer.from(
        JSON.stringify({
          lifecycle,
          sessionRetained: true,
          credentialsIsolated: true,
          inferenceRecovered: true,
          knowledgeRetained: true,
          nativeFrameDocumentsVerified: true,
          ungrantedFrameUnscanned: true,
        }),
      ),
      contentType: "application/json",
    });
  } finally {
    await app?.close();
    await fixture.close();
  }
});
