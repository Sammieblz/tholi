import { useEffect, useState } from "react";
import { Download } from "iconoir-react";
export interface DownloadManifest {
  version: string;
  url: string;
  sha256: string;
  bytes: number;
  status: string;
}
export function useDownload() {
  const [download, setDownload] = useState<DownloadManifest>();
  useEffect(() => {
    const controller = new AbortController();
    fetch("/downloads/manifest.json", { signal: controller.signal })
      .then((r) =>
        r.ok && r.headers.get("content-type")?.includes("application/json")
          ? r.json()
          : undefined,
      )
      .then((value) => {
        if (
          value &&
          /^\/downloads\/[\w.-]+\.zip$/.test(value.url) &&
          /^[a-f0-9]{64}$/.test(value.sha256)
        )
          setDownload(value);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return download;
}
export function DownloadButton({ download }: { download?: DownloadManifest }) {
  return download ? (
    <a className="web-primary" href={download.url} download>
      <Download width={19} aria-hidden="true" />
      Download extension preview
    </a>
  ) : (
    <span className="small" role="status">
      No packaged download is available. Build instructions are below.
    </span>
  );
}
