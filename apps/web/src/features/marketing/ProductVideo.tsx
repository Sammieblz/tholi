import { useEffect, useRef, useState } from "react";
import { Play, Pause } from "iconoir-react";
import { usePreferences } from "../preferences";
import "./video.css";

interface VideoVariant {
  src: string;
  poster: string;
  width: number;
  height: number;
  fps: number;
}
interface VideoManifest {
  label: string;
  request: string;
  source: string;
  transcript: string;
  provenance: string;
  variants: Record<"light" | "dark", VideoVariant>;
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
    <RecordedVideo variant={manifest.variants[theme]} manifest={manifest} />
  );
}
function RecordedVideo({
  variant,
  manifest,
}: {
  variant: VideoVariant;
  manifest: VideoManifest;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const manualPause = useRef(false);
  const explicitPlayback = useRef(false);
  const playhead = useRef({ src: variant.src, time: 0 });
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection;
    let visible = false;
    let disposed = false;
    let starting = false;
    const update = () => {
      const element = video.current;
      if (!element) return;
      if (
        !visible ||
        document.hidden ||
        manualPause.current ||
        (!explicitPlayback.current && (reduced.matches || connection?.saveData))
      ) {
        element.pause();
        return;
      }
      if (element.paused && !starting) {
        starting = true;
        setLoaded(true);
        void element
          .play()
          .then(() => {
            if (!disposed) setNotice("");
          })
          .catch(() => {
            if (!disposed) setNotice("Select Resume to watch the recording.");
          })
          .finally(() => {
            starting = false;
          });
      }
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting && entry.intersectionRatio >= 0.45;
        update();
      },
      { threshold: 0.45 },
    );
    if (frame.current) observer.observe(frame.current);
    document.addEventListener("visibilitychange", update);
    reduced.addEventListener("change", update);
    const element = video.current;
    element?.addEventListener("loadedmetadata", update);
    return () => {
      disposed = true;
      observer.disconnect();
      element?.pause();
      element?.removeEventListener("loadedmetadata", update);
      document.removeEventListener("visibilitychange", update);
      reduced.removeEventListener("change", update);
    };
  }, [variant.src]);
  const play = () => {
    const element = video.current;
    if (!element) return;
    manualPause.current = false;
    explicitPlayback.current = true;
    setLoaded(true);
    void element
      .play()
      .then(() => setNotice(""))
      .catch(() =>
        setNotice(
          "Playback is unavailable. Read the transcript or try practice below.",
        ),
      );
  };
  return (
    <figure className="product-video">
      <div className="video-frame" ref={frame}>
        <video
          ref={video}
          width={variant.width}
          height={variant.height}
          poster={variant.poster}
          src={variant.src}
          preload={loaded ? "metadata" : "none"}
          muted
          playsInline
          loop
          onPlay={() => {
            setPlaying(true);
            setError(false);
          }}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(event) => {
            if (
              event.currentTarget.readyState >= 1 &&
              playhead.current.src === variant.src
            )
              playhead.current.time = event.currentTarget.currentTime;
          }}
          onLoadedMetadata={(event) => {
            if (playhead.current.src !== variant.src) {
              event.currentTarget.currentTime = Math.min(
                playhead.current.time,
                Math.max(0, event.currentTarget.duration - 0.05),
              );
              playhead.current.src = variant.src;
            }
          }}
          onError={() => setError(true)}
          aria-label={`Actual Tholi extension: ${manifest.label}`}
        >
          Your browser cannot play this recording. Read the transcript below.
        </video>
      </div>
      <div className="video-toolbar">
        <div className="video-playback">
          <button
            onClick={() => {
              if (playing) {
                manualPause.current = true;
                video.current?.pause();
              } else play();
            }}
          >
            {playing ? (
              <Pause aria-hidden="true" />
            ) : (
              <Play aria-hidden="true" />
            )}
            {playing ? "Pause" : "Resume"}
          </button>
        </div>
        <span>Actual extension · {manifest.label}</span>
      </div>
      <figcaption>
        <strong>One genuine journey, from request to verified result.</strong>
        <p>
          {manifest.request} This recording shows an actual public-page
          workflow, not a guarantee of every website’s reliability.
        </p>
        <div>
          <a href={manifest.transcript}>Read the transcript</a>
          <a href={manifest.provenance}>Recording provenance</a>
        </div>
      </figcaption>
      {(error || notice) && (
        <p role="status">
          {notice ||
            "The video could not be played. The transcript and interactive practice are available."}
        </p>
      )}
    </figure>
  );
}
