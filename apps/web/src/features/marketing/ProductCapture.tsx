import { Dialog } from "@base-ui/react/dialog";
import { Expand, Xmark } from "iconoir-react";
import "./screenshots.css";

export function ProductCapture({
  name,
  title,
  description,
  width,
  height,
  eager = false,
  panel = false,
}: {
  name: string;
  title: string;
  description: string;
  width: number;
  height: number;
  eager?: boolean;
  panel?: boolean;
}) {
  const source = `/media/screenshots/${name}.webp`;
  return (
    <figure className={`product-capture${panel ? " panel-capture" : ""}`}>
      <Dialog.Root>
        <Dialog.Trigger
          className="capture-open"
          aria-label={`Enlarge screenshot: ${title}`}
        >
          <img
            src={source}
            alt={description}
            width={width}
            height={height}
            loading={eager ? "eager" : "lazy"}
            fetchPriority={eager ? "high" : "auto"}
            decoding="async"
          />
          <span className="capture-expand">
            <Expand width={16} aria-hidden="true" />
            <span>View screenshot</span>
          </span>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Backdrop className="capture-backdrop" />
          <Dialog.Popup className="capture-dialog">
            <div className="capture-dialog-heading">
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Close
                className="icon-button"
                aria-label="Close screenshot"
              >
                <Xmark aria-hidden="true" />
              </Dialog.Close>
            </div>
            <img src={source} alt={description} width={width} height={height} />
            <Dialog.Description>{description}</Dialog.Description>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      <figcaption>
        <strong>{title}</strong>
        <span>{description}</span>
      </figcaption>
    </figure>
  );
}
