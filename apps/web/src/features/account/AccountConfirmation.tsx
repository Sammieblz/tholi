import { AlertDialog } from "@base-ui/react/alert-dialog";

/** Shared account confirmation keeps destructive actions on the existing primitive. */
export function AccountConfirmation({
  title,
  description,
  label,
  busy,
  onConfirm,
}: {
  title: string;
  description: string;
  label: string;
  busy: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger disabled={busy}>{label}</AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="account-dialog-backdrop" />
        <AlertDialog.Popup className="account-dialog">
          <AlertDialog.Title>{title}</AlertDialog.Title>
          <AlertDialog.Description>{description}</AlertDialog.Description>
          <div className="account-actions">
            <AlertDialog.Close>Cancel</AlertDialog.Close>
            <AlertDialog.Close onClick={onConfirm}>Confirm</AlertDialog.Close>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
