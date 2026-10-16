import { useEffect, useRef, useState } from "react";
import { Wayfinder } from "../../../../../packages/ui/WayfinderMark";
import type { WayfinderState } from "../../../../../packages/ui/wayfinder";

const scenes: { state: WayfinderState; name: string; text: string }[] = [
  {
    state: "idle",
    name: "Waiting",
    text: "A little breath before the next destination.",
  },
  {
    state: "planning",
    name: "Finding a way",
    text: "The point becomes a route while Tholi looks for evidence.",
  },
  {
    state: "guiding",
    name: "On your way",
    text: "A point on a path, keeping the next step in view.",
  },
  {
    state: "verifying",
    name: "Checking",
    text: "A moment to check the result, without claiming success.",
  },
  {
    state: "attention",
    name: "A moment for you",
    text: "Still and attentive when a decision needs your input.",
  },
  {
    state: "paused",
    name: "Taking a pause",
    text: "The movement settles. Your destination stays with you.",
  },
  {
    state: "arrived",
    name: "Arrived",
    text: "The point opens into a check for a verified outcome.",
  },
  {
    state: "unresolved",
    name: "No clear route yet",
    text: "An honest pause in the search. The destination is retained.",
  },
];

/** Marketing-only state sequence. It never emits navigation or outcome evidence. */
export function WayfinderStage() {
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(media.matches);
    media.addEventListener("change", change);
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting && !document.hidden),
      { threshold: 0.2 },
    );
    if (ref.current) observer.observe(ref.current);
    const visibility = () =>
      setVisible(
        !document.hidden &&
          !!ref.current &&
          ref.current.getBoundingClientRect().bottom > 0 &&
          ref.current.getBoundingClientRect().top < innerHeight,
      );
    document.addEventListener("visibilitychange", visibility);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", change);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  useEffect(() => {
    if (reduced || !visible) return;
    const timer = window.setTimeout(
      () => setIndex((current) => (current + 1) % scenes.length),
      3600,
    );
    return () => clearTimeout(timer);
  }, [index, reduced, visible]);
  const scene = scenes[index];
  return (
    <div
      ref={ref}
      className="wayfinder-stage"
      data-playing={!reduced && visible}
    >
      <div className="wayfinder-stage-art">
        <Wayfinder state={scene.state} animate={!reduced && visible} />
      </div>
      <div className="wayfinder-stage-caption">
        <strong>{scene.name}</strong>
        <p>{scene.text}</p>
      </div>
      <p className="small stage-disclaimer">
        Brand-motion demonstration. These states are illustrative, not a live
        navigation result.
      </p>
    </div>
  );
}
