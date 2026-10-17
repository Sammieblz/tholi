import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { NavArrowRight, Xmark } from "iconoir-react";
import type { GuidanceProps } from "./types";
import type { WidgetDensity } from "../widget-density";

/** One visible decision; its full controls remain mounted through resizing. */
export function WidgetAttention(
  props: GuidanceProps & { density: WidgetDensity },
) {
  const [open, setOpen] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const [summary, setSummary] = useState(
    props.error || props.presentation.title,
  );
  useLayoutEffect(() => {
    setSummary(
      props.error ||
        content.current?.querySelector("h2,h3")?.textContent?.trim() ||
        props.presentation.title,
    );
  }, [props.error, props.attention, props.primary, props.presentation.title]);
  useEffect(() => setOpen(false), [props.presentation.stepId]);
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && props.density !== "expanded") props.onExpand?.(false);
      }}
    >
      <section
        className="tholi-widget-attention"
        aria-label="Important guidance"
      >
        <Popover.Trigger className="tholi-attention-trigger">
          <span>
            <strong
              role="status"
              aria-label="Navigation status"
              aria-live="polite"
            >
              {summary}
            </strong>
            <span>Review details</span>
          </span>
          <NavArrowRight width={18} aria-hidden="true" />
        </Popover.Trigger>
      </section>
      <Popover.Portal keepMounted>
        <Popover.Positioner
          sideOffset={8}
          align="start"
          className="tholi-attention-positioner"
        >
          <Popover.Popup className="tholi-popover tholi-attention-popup">
            <div className="tholi-popover-heading">
              <Popover.Title>{props.presentation.title}</Popover.Title>
              <Popover.Close
                className="icon-button"
                aria-label="Close guidance details"
              >
                <Xmark width={18} aria-hidden="true" />
              </Popover.Close>
            </div>
            {props.error && (
              <p role="alert" className="tholi-error">
                {props.error}
              </p>
            )}
            <div ref={content}>
              {props.attention || props.children}
              {props.primary}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
