import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Restart, Trash } from "iconoir-react";

export function ConfirmAction({
  title,
  description,
  action,
  disabled = false,
  compact = false,
  label,
  icon = "trash",
}: {
  title: string;
  description: string;
  action: () => void | Promise<unknown>;
  disabled?: boolean;
  compact?: boolean;
  label?: string;
  icon?: "trash" | "reset";
}) {
  const Icon = icon === "reset" ? Restart : Trash;
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger
        className={"tholi-danger-action" + (compact ? " compact" : "")}
        disabled={disabled}
        aria-label={label}
      >
        <Icon width={17} aria-hidden="true" />
        <span>{title}</span>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="tholi-confirm-backdrop" />
        <AlertDialog.Popup className="tholi-confirm">
          <AlertDialog.Title>{title}?</AlertDialog.Title>
          <AlertDialog.Description>{description}</AlertDialog.Description>
          <div className="tholi-confirm-actions">
            <AlertDialog.Close>Keep it</AlertDialog.Close>
            <AlertDialog.Close
              className="tholi-danger-action"
              onClick={() => void action()}
            >
              <Icon width={17} aria-hidden="true" />
              {title}
            </AlertDialog.Close>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
