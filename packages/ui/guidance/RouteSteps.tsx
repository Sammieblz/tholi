import type { GuidancePresentation } from "../presentation";
import { routeProgressNodes, type RouteProgress } from "../route-progress";
import { useVisibleMotion } from "../motion/useVisibleMotion";

export function RouteSteps({
  progress,
  presentation,
}: {
  progress: RouteProgress;
  presentation: GuidancePresentation;
}) {
  const { ref, visible } = useVisibleMotion<HTMLElement>();
  const arrived = progress.arrived && presentation.phase === "arrived";
  const moving =
    visible &&
    !arrived &&
    ["guiding", "verifying", "recovering"].includes(presentation.phase) &&
    presentation.marker !== "unresolved";
  const nodes = routeProgressNodes({ ...progress, arrived });
  const total = progress.verified + progress.next.length;
  const label = arrived
    ? "Destination verified"
    : progress.next.length
      ? progress.complete
        ? `Step ${progress.verified + 1} of ${total} estimated`
        : `Step ${progress.verified + 1} · ${progress.next.length} known from here`
      : `${progress.verified} verified · ${presentation.phase === "paused" ? "Paused" : presentation.phase === "review" ? "Review needed" : presentation.phase === "authentication" ? "Signing in" : "Finding next step"}`;
  return (
    <section
      ref={ref}
      className="tholi-route-steps"
      aria-label="Journey steps"
      data-moving={moving}
      data-arrived={arrived}
    >
      <div className="tholi-route-caption">
        <span>{label}</span>
        <span className="tholi-route-note">
          {arrived
            ? `${progress.verified} verified`
            : progress.complete
              ? "Rechecked as you go"
              : "More may appear"}
        </span>
      </div>
      <ol className="tholi-route-nodes" aria-label={label}>
        {nodes.map((node, index) => {
          const checked =
            node.state === "verified" ||
            (node.state === "destination" && arrived);
          return (
            <li
              key={`${progress.journeyId}:${node.id}`}
              className="tholi-route-stop"
              data-state={node.state}
              data-checked={checked}
              aria-current={node.state === "current" ? "step" : undefined}
            >
              {index > 0 && (
                <span className="tholi-route-connector" aria-hidden="true">
                  <span className="tholi-route-signal" />
                </span>
              )}
              <span
                className="tholi-route-node"
                title={`${node.label}${node.detail ? ` · ${node.detail}` : ""}`}
              >
                {checked ? (
                  node.id === "earlier" ? (
                    <span aria-hidden="true">{node.detail}</span>
                  ) : (
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="m6 12 4 4 8-9" />
                    </svg>
                  )
                ) : node.state === "more" ? (
                  <span aria-hidden="true">···</span>
                ) : node.state === "destination" ? (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M7 20V5m0 0c4-4 6 4 11 0v9c-5 4-7-4-11 0" />
                  </svg>
                ) : (
                  <span aria-hidden="true">{node.number}</span>
                )}
                <span className="sr-only">
                  {node.number ? `Step ${node.number}: ` : ""}
                  {node.label}. {checked ? "Verified." : node.detail}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
