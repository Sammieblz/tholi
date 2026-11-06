import { useEffect, useRef, useState, type ReactNode } from "react";
import { RecordedVideo, type RecordingSource } from "./RecordedVideo";
import "./styles/onboarding.css";

export const introductionChapters = [
  {
    label: "Your destination",
    title: "Tell Tholi where you want to go.",
    text: "Less hunting through unfamiliar menus. More getting on with your day. Describe the result you want in your own words, and Tholi helps you find a next step on the website in front of you.",
  },
  {
    label: "Your next step",
    title: "Find your next step. Stay in control.",
    text: "A clear instruction. A highlight on the page. Follow along in Guide, ask a question in Conversation, or keep Tholi close in the floating widget. You make the clicks. Tholi checks your progress, and you can pause or stop whenever you need.",
  },
  {
    label: "Your choice",
    title: "Your account is optional.",
    text: "Start with local guidance, with no account required. An account gives you a place to manage available connected features. Sharing local data and enabling cloud processing remain separate choices.",
  },
] as const;

export function introductionStep(value: string | null) {
  return value === "2" ? 2 : value === "3" ? 3 : 1;
}

/** Shared explanation only. Each host owns navigation, credentials and completion. */
export function Introduction({
  step,
  onStep,
  register,
  local,
  signIn,
  notice,
}: {
  step: number;
  onStep: (step: number) => void;
  register: ReactNode;
  local: ReactNode;
  signIn: ReactNode;
  notice?: ReactNode;
}) {
  const chapter = introductionChapters[step - 1] ?? introductionChapters[0];
  const section = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const previous = useRef(step);
  useEffect(() => {
    if (previous.current !== step) {
      const keyboard = document.documentElement.dataset.input === "keyboard";
      heading.current?.focus({ preventScroll: !keyboard });
      if (!keyboard)
        section.current?.scrollIntoView({
          block: "start",
          behavior: "instant",
        });
    }
    previous.current = step;
  }, [step]);
  return (
    <section
      ref={section}
      className="tholi-introduction"
      aria-label="An introduction to Tholi"
    >
      <ol
        className="tholi-introduction-progress"
        aria-label="Introduction progress"
      >
        {introductionChapters.map((item, index) => (
          <li
            key={item.label}
            aria-current={step === index + 1 ? "step" : undefined}
          >
            <span aria-hidden="true">0{index + 1}</span>
            {item.label}
          </li>
        ))}
      </ol>
      <div className="tholi-introduction-layout">
        <IntroductionRecording key={step} step={step} />
        <div className="tholi-introduction-copy">
          <p className="tholi-introduction-eyebrow">
            A LITTLE DIRECTION GOES A LONG WAY
          </p>
          <h1 ref={heading} tabIndex={-1}>
            {chapter.title}
          </h1>
          <p>{chapter.text}</p>
          {step === 1 && (
            <div className="tholi-introduction-examples">
              <p>A few ways to begin</p>
              <ul>
                <li>
                  <q>Find the language settings.</q>
                </li>
                <li>
                  <q>Show me where to create a new repository.</q>
                </li>
              </ul>
            </div>
          )}
          <div className="tholi-introduction-actions">
            {step > 1 && (
              <button type="button" onClick={() => onStep(step - 1)}>
                Back
              </button>
            )}
            {step < 3 ? (
              <button
                type="button"
                className="tholi-introduction-primary"
                onClick={() => onStep(step + 1)}
              >
                Next
              </button>
            ) : (
              register
            )}
          </div>
          {step < 3 && (
            <div className="tholi-introduction-skip">{register}</div>
          )}
          {notice}
          <div className="tholi-introduction-alternatives">
            {local}
            <span>No account required</span>
            {signIn}
          </div>
        </div>
      </div>
    </section>
  );
}

interface IntroductionClip extends RecordingSource {
  id: string;
  label: string;
  description: string;
  transcript: string;
}

/** Genuine, local recordings. Playback never controls an installed extension. */
export function IntroductionRecording({ step }: { step: number }) {
  const [clips, setClips] = useState<IntroductionClip[]>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/media/onboarding/manifest.json", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw Error("Recording unavailable");
        const manifest = await response.json();
        const ids = ["destination", "guidance", "local"];
        if (
          manifest.schemaVersion !== 1 ||
          !Array.isArray(manifest.clips) ||
          manifest.clips.length !== ids.length ||
          manifest.clips.some(
            (clip: IntroductionClip, index: number) =>
              clip.id !== ids[index] ||
              ![clip.src, clip.poster, clip.captions, clip.transcript].every(
                (path) =>
                  typeof path === "string" &&
                  /^\/media\/onboarding\/[a-z-]+\.(?:webm|webp|vtt|txt)$/.test(
                    path,
                  ),
              ) ||
              clip.width !== 1040 ||
              clip.height !== 800 ||
              typeof clip.label !== "string" ||
              typeof clip.description !== "string",
          )
        )
          throw Error("Recording incomplete");
        setClips(manifest.clips);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, []);
  const clip = clips?.[Math.min(2, Math.max(0, step - 1))];
  return (
    <div className="tholi-introduction-scene">
      <p className="tholi-recording-kicker">
        SEE THOLI IN ACTION <span>Recorded from the real extension</span>
      </p>
      {clip ? (
        <RecordedVideo
          key={clip.id}
          variant={clip}
          label={clip.label}
          autoPlay={false}
          loop={false}
          controls
        >
          <strong>{clip.label}</strong>
          <p>{clip.description}</p>
          <div>
            <a href={clip.transcript}>Read the transcript</a>
          </div>
        </RecordedVideo>
      ) : (
        <div className="video-unavailable" role="status">
          <p>
            {failed
              ? "The recording could not be loaded. You can continue the introduction without it."
              : "Loading the real extension recording..."}
          </p>
        </div>
      )}
      <p className="tholi-recording-note">
        Play to watch, or open fullscreen for a closer look. No sound. Playback
        does not control your extension.
      </p>
    </div>
  );
}
