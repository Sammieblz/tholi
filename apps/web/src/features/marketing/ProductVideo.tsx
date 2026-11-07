import { useEffect, useState } from "react";
import { usePreferences } from "../preferences";
import {
  RecordedVideo,
  type RecordingSource,
} from "../../../../../packages/ui/RecordedVideo";

interface VideoManifest {
  label: string;
  request: string;
  source: string;
  transcript: string;
  provenance: string;
  variants: Record<"light" | "dark", RecordingSource>;
}
export function ProductVideo() {
  const { theme } = usePreferences();
  const [manifest, setManifest] = useState<VideoManifest>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/media/video/manifest.json", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Recording unavailable");
        const value = (await response.json()) as VideoManifest;
        if (!value.variants?.light?.src || !value.variants?.dark?.src)
          throw new Error("Recording incomplete");
        setManifest(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, []);
  if (!manifest)
    return (
      <div className="video-unavailable" role="status">
        <p>
          {failed
            ? "The recording could not be loaded. You can still try the interactive practice below."
            : "Loading the real extension recording…"}
        </p>
        <a href="#practice">Try the practice</a>
      </div>
    );
  return (
    <RecordedVideo variant={manifest.variants[theme]} label={manifest.label}>
      <strong>One genuine journey, from request to verified result.</strong>
      <p>
        {manifest.request} This recording shows an actual public-page workflow,
        not a guarantee of every website's reliability.
      </p>
      <div>
        <a href={manifest.transcript}>Read the transcript</a>
        <a href={manifest.provenance}>Recording provenance</a>
      </div>
    </RecordedVideo>
  );
}
