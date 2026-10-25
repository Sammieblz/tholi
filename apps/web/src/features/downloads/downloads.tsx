import { useEffect, useState } from "react";
import { Download, Refresh } from "iconoir-react";
import { Wayfinder } from "../../../../../packages/ui/WayfinderMark";
import { SiteLink } from "../../app/router";
import { usePreferences } from "../preferences";
import {
  desktopStore,
  selectedBrowser,
  stores,
  type ExtensionTarget,
} from "./browsers";
export function StoreLink({
  target,
  className = "web-primary",
  describedBy,
}: {
  target: ExtensionTarget;
  className?: string;
  describedBy?: string;
}) {
  const store = stores[target];
  return (
    <a href={store.url} className={className} aria-describedby={describedBy}>
      Add to {store.name}
    </a>
  );
}
export function InstallLink({
  className = "web-primary",
}: {
  className?: string;
}) {
  const store = desktopStore();
  return store ? (
    <StoreLink
      target={store.id === "firefox" ? "firefox" : "chromium"}
      className={className}
    />
  ) : (
    <SiteLink to="/download" className={className}>
      Get Tholi
    </SiteLink>
  );
}
export interface DownloadManifest {
  version: string;
  url: string;
  sha256: string;
  bytes: number;
  status: string;
  target?: ExtensionTarget;
  minimumBrowserVersion?: string;
  installationKind?: "unpacked" | "temporary";
}
export type DownloadState = {
  status: "loading" | "available" | "unavailable" | "error";
  release?: DownloadManifest;
  retry: () => void;
};
export function useDownload(
  target: ExtensionTarget = selectedBrowser().target as ExtensionTarget,
): DownloadState {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    target: ExtensionTarget;
    value: Omit<DownloadState, "retry">;
  }>({ target, value: { status: "loading" } });
  useEffect(() => {
    const controller = new AbortController();
    setResult({ target, value: { status: "loading" } });
    void fetch("/downloads/manifest.json", { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404) return { status: "unavailable" as const };
        if (!response.ok) throw new Error("Download information unavailable");
        if (!response.headers.get("content-type")?.includes("application/json"))
          return { status: "unavailable" as const };
        const value: unknown = await response.json();
        if (!value || typeof value !== "object")
          throw new Error("Invalid download information");
        const manifest = value as {
          schemaVersion?: number;
          targets?: Partial<Record<ExtensionTarget, DownloadManifest>>;
        };
        const release =
          manifest.schemaVersion === 2
            ? manifest.targets?.[target]
            : target === "chromium"
              ? (value as DownloadManifest)
              : undefined;
        if (!release) return { status: "unavailable" as const };
        if (
          (manifest.schemaVersion === 2 &&
            (release.target !== target ||
              release.installationKind !==
                (target === "firefox" ? "temporary" : "unpacked") ||
              typeof release.minimumBrowserVersion !== "string")) ||
          (manifest.schemaVersion !== 2 &&
            release.target !== undefined &&
            release.target !== "chromium") ||
          typeof release.url !== "string" ||
          !/^\/downloads\/[\w.-]+\.zip$/.test(release.url) ||
          typeof release.sha256 !== "string" ||
          !/^[a-f0-9]{64}$/.test(release.sha256) ||
          typeof release.version !== "string" ||
          !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(release.version) ||
          !Number.isSafeInteger(release.bytes) ||
          release.bytes <= 0 ||
          typeof release.status !== "string"
        )
          throw new Error("Invalid download information");
        return { status: "available" as const, release };
      })
      .then((next) => {
        if (!controller.signal.aborted) setResult({ target, value: next });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setResult({ target, value: { status: "error" } });
      });
    return () => controller.abort();
  }, [attempt, target]);
  return {
    ...(result.target === target
      ? result.value
      : { status: "loading" as const }),
    retry: () => setAttempt((value) => value + 1),
  };
}
export function DownloadButton({ download }: { download: DownloadState }) {
  const { trackEvent } = usePreferences();
  if (download.status === "available" && download.release)
    return (
      <a
        className="web-primary"
        href={download.release.url}
        download
        onClick={() => trackEvent({ name: "download_click" })}
      >
        <Download width={19} aria-hidden="true" />
        {download.release.target === "firefox"
          ? "Download Firefox developer ZIP"
          : "Download Chromium developer ZIP"}
      </a>
    );
  if (download.status === "loading")
    return (
      <div className="download-status" role="status">
        <Wayfinder state="planning" />
        Finding the developer package…
      </div>
    );
  if (download.status === "error")
    return (
      <div className="download-status download-problem">
        <p role="status">
          The developer download information could not be loaded. Store
          installation is still available above.
        </p>
        <button onClick={download.retry}>
          <Refresh width={16} aria-hidden="true" />
          Try again
        </button>
      </div>
    );
  return (
    <p className="download-status" role="status">
      No packaged download is available. Build instructions are below.
    </p>
  );
}
