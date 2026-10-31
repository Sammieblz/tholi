import { useRef, useState } from "react";
import { diagnosticSchema } from "../../../../../packages/navigation-core/contracts-support";
import type { useAccount } from "../account/session";
import { AccountFileDelivery } from "../account/AccountFileDelivery";
import { useAccountOperation } from "../account/useAccountOperation";

export function AccountDiagnostic({
  account,
}: {
  account: ReturnType<typeof useAccount>;
}) {
  const [fileId, setFileId] = useState<string>();
  const operation = useAccountOperation(account);
  const requestKey = useRef<string | undefined>(undefined);
  const create = () =>
    operation.run(
      async (signal) => {
        requestKey.current ??= crypto.randomUUID();
        const result = await account.request(
          "/api/v1/account/diagnostic-exports",
          diagnosticSchema,
          "POST",
          { idempotencyKey: requestKey.current },
          signal,
        );
        return result;
      },
      (result) => {
        requestKey.current = undefined;
        setFileId(result.fileId);
      },
    );
  return (
    <section
      className="contact-diagnostic"
      aria-labelledby="contact-diagnostic-title"
      aria-busy={operation.busy}
    >
      <h2 id="contact-diagnostic-title">An optional account diagnostic</h2>
      <p>
        This JSON file contains the service version, your account status and job
        counts. It contains no pages, screenshots, destinations, email addresses
        or session credentials. Nothing is exported until you request it.
      </p>
      <p>
        The private file expires after one hour. Download links expire within
        one minute and still require your signed-in account. Expiry cannot be
        cancelled.
      </p>
      <div className="contact-draft-actions">
        <button
          className="web-secondary"
          type="button"
          disabled={operation.busy}
          onClick={() => void create()}
        >
          {fileId ? "Create another diagnostic" : "Create account diagnostic"}
        </button>
      </div>
      <AccountFileDelivery
        account={account}
        fileId={fileId}
        format="diagnostic"
      />
      {fileId && (
        <p>Your diagnostic has not been attached to a support request.</p>
      )}
      {operation.busy && (
        <p role="status">Requesting your account diagnostic.</p>
      )}
      {operation.error && (
        <p role="alert" className="contact-field-error">
          {operation.error}
        </p>
      )}
    </section>
  );
}
