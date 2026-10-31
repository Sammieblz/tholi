import { useEffect, useRef, useState } from "react";
import {
  accountExportInputSchema,
  accountExportManifestSchema,
  accountExportPageSchema,
  accountExportStatusSchema,
  type AccountExportManifest,
  type AccountExportStatus,
} from "../../../../../packages/navigation-core/contracts-account";
import { SUPPORT_LIMITS } from "../../../../../packages/navigation-core/contracts-support";
import { useAccount } from "./session";
import { useAccountOperation } from "./useAccountOperation";
import {
  AccountFileDelivery,
  accountFileMetadata,
  readAccountFile,
} from "./AccountFileDelivery";
import { accountError } from "./account-error";

const sections = {
  profile: "Account profile",
  contacts: "Verified contact details",
  sessions: "Sessions",
  memberships: "Workspace membership",
  consents: "Privacy choices",
  saved_data: "Saved items",
  plans: "Plan information",
  credits: "Credit balance",
  credit_history: "Credit activity",
  usage: "Usage activity",
  support: "Support requests",
  product_events: "Optional product measurements",
};

/** Account exports remain discoverable after refresh and require explicit continuation. */
export function AccountExports() {
  const account = useAccount();
  const operation = useAccountOperation(account);
  const [history, setHistory] = useState<AccountExportStatus[]>([]);
  const [after, setAfter] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<AccountExportStatus>();
  const [manifest, setManifest] = useState<{
    fileId: string;
    data: AccountExportManifest;
  }>();
  const operationKey = useRef<
    { continuation?: string; id: string } | undefined
  >(undefined);
  const actor = account.session?.account.id;
  const request = account.request;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void request(
      "/api/v1/account/exports?limit=10",
      accountExportPageSchema,
      "GET",
      undefined,
      controller.signal,
    )
      .then((page) => {
        if (controller.signal.aborted) return;
        setHistory(page.items);
        setAfter(page.nextCursor);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoadError(accountError(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [request]);

  const prepare = (continuation?: string) =>
    operation.run(
      async (signal) => {
        if (
          operationKey.current?.continuation !== continuation ||
          !operationKey.current
        )
          operationKey.current = { continuation, id: crypto.randomUUID() };
        const input = accountExportInputSchema.parse({
          idempotencyKey: operationKey.current.id,
          ...(continuation ? { continuation } : {}),
        });
        return request(
          "/api/v1/account/exports",
          accountExportStatusSchema,
          "POST",
          input,
          signal,
        );
      },
      (result) => {
        operationKey.current = undefined;
        setSelected(result);
        setManifest(undefined);
        setHistory((previous) => [
          result,
          ...previous.filter((item) => item.generation !== result.generation),
        ]);
      },
      "Your account export was prepared. Check its delivery status before downloading.",
    );
  const check = () =>
    operation.run(
      (signal) =>
        request(
          `/api/v1/account/exports/${selected!.generation}`,
          accountExportStatusSchema,
          "GET",
          undefined,
          signal,
        ),
      (result) => {
        setSelected(result);
        setHistory((previous) =>
          previous.map((item) =>
            item.generation === result.generation ? result : item,
          ),
        );
        if (result.fileId !== selected?.fileId) setManifest(undefined);
      },
    );
  const show = (fileId: string) =>
    operation.run(async (signal) => {
      const metadata = await accountFileMetadata(account, fileId, signal);
      const value = await readAccountFile(
        account,
        metadata,
        accountExportManifestSchema,
        SUPPORT_LIMITS.maxFileBytes,
        signal,
      );
      if (
        value.accountId !== actor ||
        value.generation !== selected?.generation
      )
        throw new Error("The export belongs to another account view.");
      return { fileId, data: value };
    }, setManifest);
  const more = () =>
    operation.run(
      (signal) =>
        request(
          `/api/v1/account/exports?limit=10&cursor=${encodeURIComponent(after!)}`,
          accountExportPageSchema,
          "GET",
          undefined,
          signal,
        ),
      (page) => {
        setHistory((previous) => [
          ...previous,
          ...page.items.filter(
            (item) =>
              !previous.some((old) => old.generation === item.generation),
          ),
        ]);
        setAfter(page.nextCursor);
      },
    );
  const refresh = () =>
    operation.run(
      (signal) =>
        request(
          "/api/v1/account/exports?limit=10",
          accountExportPageSchema,
          "GET",
          undefined,
          signal,
        ),
      (page) => {
        setHistory(page.items);
        setAfter(page.nextCursor);
        setLoadError("");
      },
    );
  return (
    <section
      className="account-export"
      aria-labelledby="account-export-title"
      aria-busy={operation.busy || loading}
    >
      <h2 id="account-export-title">Export your account data</h2>
      <p>
        Request a private copy of your supported account data, saved items,
        privacy choices and activity. Local extension data is separate and is
        never uploaded for this export.
      </p>
      <p>
        Exports contain an index and separate JSON files. Download the index and
        each file it lists for a complete copy. Files expire after one hour.
        Large exports may need more than one explicit preparation step.
      </p>
      <div className="account-actions">
        <button
          type="button"
          className="web-secondary"
          disabled={operation.busy || !actor}
          onClick={() => void prepare()}
        >
          Export account data
        </button>
        <button
          type="button"
          className="web-secondary"
          disabled={operation.busy || loading}
          onClick={() => void refresh()}
        >
          Refresh export requests
        </button>
      </div>
      {loading && <p role="status">Loading your export requests.</p>}
      {history.length > 0 && (
        <ul className="account-export-history">
          {history.map((item, index) => (
            <li key={item.generation}>
              <button
                type="button"
                disabled={operation.busy}
                onClick={() => {
                  setSelected(item);
                  setManifest(undefined);
                }}
              >
                Review export {index + 1}
              </button>
              <span>
                Expires{" "}
                <time dateTime={item.expiresAt}>
                  {new Date(item.expiresAt).toLocaleString()}
                </time>
              </span>
            </li>
          ))}
        </ul>
      )}
      {after && (
        <button
          type="button"
          disabled={operation.busy}
          onClick={() => void more()}
        >
          Load older export requests
        </button>
      )}
      {loadError && (
        <p className="auth-error" role="alert">
          {loadError}
        </p>
      )}
      {selected && (
        <div className="account-export-details">
          <p role="status">
            {selected.delivery === "pending"
              ? "Your export files are being prepared for download."
              : selected.delivery === "ready"
                ? "Export files are available. Review the index to see the exact contents."
                : "This export is no longer fully available. You can request a new copy."}
          </p>
          {selected.preparation === "partial" && (
            <p>
              Some data remains outside this preparation step. The index
              explains its contents and any exclusions.
            </p>
          )}
          <div className="account-actions">
            <button
              type="button"
              disabled={operation.busy}
              onClick={() => void check()}
            >
              Check export status
            </button>
            <button
              type="button"
              disabled={operation.busy}
              onClick={() => void show(selected.fileId)}
            >
              Show export files
            </button>
            {selected.continuation && (
              <button
                type="button"
                disabled={operation.busy}
                onClick={() => void prepare(selected.continuation!)}
              >
                Continue preparing export
              </button>
            )}
          </div>
          {manifest && (
            <>
              <p>
                {manifest.data.complete
                  ? "This index reports the supported export as complete."
                  : "This index describes a partial export. Review any remaining steps and exclusions below."}
              </p>
              <AccountFileDelivery
                account={account}
                fileId={manifest.fileId}
                format="account-manifest"
                expected={{ generation: selected.generation }}
              />
              {manifest.data.previousManifestFileId && (
                <button
                  type="button"
                  disabled={operation.busy}
                  onClick={() =>
                    void show(manifest.data.previousManifestFileId!)
                  }
                >
                  Review previous export page
                </button>
              )}
              {manifest.data.omissions.length > 0 && (
                <ul>
                  {manifest.data.omissions.map((item, index) => (
                    <li key={index}>
                      {sections[item.section]}:{" "}
                      {item.reason === "not-exportable"
                        ? "Some retained data is outside the supported export format."
                        : "Access or data changed during collection. Request a new export if needed."}
                    </li>
                  ))}
                </ul>
              )}
              <ul className="account-export-files">
                {manifest.data.parts.map((part, index) => (
                  <li key={part.fileId}>
                    <h3>
                      {sections[part.section]}, file {index + 1}
                    </h3>
                    <p>{part.count} records in this file.</p>
                    <AccountFileDelivery
                      account={account}
                      fileId={part.fileId}
                      format="account-part"
                      expected={{ generation: manifest.data.generation, part }}
                      label={`${sections[part.section]}, file ${index + 1}`}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {operation.notice && <p role="status">{operation.notice}</p>}
      {operation.error && (
        <p role="alert" className="auth-error">
          {operation.error}
        </p>
      )}
    </section>
  );
}
