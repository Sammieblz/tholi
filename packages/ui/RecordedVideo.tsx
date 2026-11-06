import { Pause, Play } from "iconoir-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import "./styles/recorded-video.css";

export interface RecordingSource {
  src: string;
  poster: string;
  captions?: string;
  width: number;
  height: number;
}

export function RecordedVideo({
  variant,
  label,
  children,
  autoPlay = true,
  loop = true,
  controls = false,
}: {
  variant: RecordingSource;
  label: string;
  children?: ReactNode;
  autoPlay?: boolean;
  loop?: boolean;
  controls?: boolean;
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
        (autoPlay &&
          !explicitPlayback.current &&
          (reduced.matches || connection?.saveData))
      ) {
        element.pause();
        return;
      }
      if (!autoPlay) {
        // Give native controls a duration and decoded poster without starting
        // playback or leaving their loading indicator over the paused image.
        setLoaded(true);
        return;
      }
      if (element.ended) return;
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
  }, [variant.src, autoPlay]);
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
        setNotice("Playback is unavailable. Read the transcript below."),
      );
  };
  return (
    <figure className="product-video" data-native-controls={controls}>
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
          loop={loop}
          controls={controls}
          onPlay={() => {
            if (controls) explicitPlayback.current = true;
            setLoaded(true);
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
          aria-label={`Actual Tholi extension: ${label}`}
        >
          {controls && variant.captions && (
            <track
              key={variant.captions}
              kind="captions"
              src={variant.captions}
              srcLang="en"
              label="English descriptions"
              default
            />
          )}
          Your browser cannot play this recording. Read the transcript below.
        </video>
      </div>
      {!controls && (
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
          <span>Actual extension · {label}</span>
        </div>
      )}
      {children && <figcaption>{children}</figcaption>}
      {(error || notice) && (
        <p role="status">
          {notice ||
            "The video could not be played. You can read the transcript below and continue without playback."}
        </p>
      )}
    </figure>
  );
}
