import { useEffect, useState } from "react";
import { Download, Refresh } from "iconoir-react";
import { Wayfinder } from "../../../../../packages/ui/WayfinderMark";
export interface DownloadManifest {
  version: string;
  url: string;
  sha256: string;
  bytes: number;
  status: string;
}
export type DownloadState = {
  status: "loading" | "available" | "unavailable" | "error";
  release?: DownloadManifest;
  retry: () => void;
};
export function useDownload(): DownloadState {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Omit<DownloadState, "retry">>({
    status: "loading",
  });
  useEffect(() => {
    const controller = new AbortController();
    setResult({ status: "loading" });
    void fetch("/downloads/manifest.json", { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404) return { status: "unavailable" as const };
        if (!response.ok) throw new Error("Download information unavailable");
        if (!response.headers.get("content-type")?.includes("application/json"))
          return { status: "unavailable" as const };
        const value: unknown = await response.json();
        if (!value || typeof value !== "object")
          throw new Error("Invalid download information");
        const release = value as DownloadManifest;
        if (
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
        if (!controller.signal.aborted) setResult(next);
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ status: "error" });
      });
    return () => controller.abort();
  }, [attempt]);
  return { ...result, retry: () => setAttempt((value) => value + 1) };
}
export function DownloadButton({ download }: { download: DownloadState }) {
  if (download.status === "available" && download.release)
    return (
      <a className="web-primary" href={download.release.url} download>
        <Download width={19} aria-hidden="true" />
        Download extension preview
      </a>
    );
  if (download.status === "loading")
    return (
      <div className="download-status" role="status">
        <Wayfinder state="planning" />
        Finding the packaged preview…
      </div>
    );
  if (download.status === "error")
    return (
      <div className="download-status download-problem">
        <p role="status">
          The download information could not be loaded. Your account is not
          needed.
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
