import { useEffect, useRef, useState } from "react";
import {
  SUPPORT_LIMITS,
  diagnosticSchema,
  diagnosticSnapshotSchema,
  fileDownloadQuerySchema,
  fileLinkSchema,
  privateFileSchema,
  type PrivateFile,
} from "../../../../../packages/navigation-core/contracts-support";
import { serviceApiOrigin } from "../../config/project";
import type { useAccount } from "../account/session";

export function AccountDiagnostic({
  account,
}: {
  account: ReturnType<typeof useAccount>;
}) {
  const [file, setFile] = useState<PrivateFile>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const requestKey = useRef<string | undefined>(undefined);
  const urls = useRef(new Set<string>());
  useEffect(
    () => () => {
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current.clear();
    },
    [],
  );

  const perform = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The diagnostic could not be opened. Try again when you are ready.",
      );
    } finally {
      setBusy(false);
    }
  };
  const create = () =>
    perform(async () => {
      requestKey.current ??= crypto.randomUUID();
      const result = await account.request(
        "/api/v1/account/diagnostic-exports",
        diagnosticSchema,
        "POST",
        { idempotencyKey: requestKey.current },
      );
      const metadata = await account.request(
        `/api/v1/account/files/${result.fileId}`,
        privateFileSchema,
      );
      requestKey.current = undefined;
      setFile(metadata);
      setNotice(
        metadata.status === "ready"
          ? "Your diagnostic is ready to download."
          : "Your diagnostic is queued. Check its status in a moment.",
      );
    });
  const check = () =>
    perform(async () => {
      if (!file) return;
      const metadata = await account.request(
        `/api/v1/account/files/${file.id}`,
        privateFileSchema,
      );
      setFile(metadata);
      setNotice(
        metadata.status === "ready"
          ? "Your diagnostic is ready to download."
          : metadata.status === "pending"
            ? "Your diagnostic is still queued."
            : "This diagnostic is no longer available. You can create another one.",
      );
    });
  const download = () =>
    perform(async () => {
      if (!file || !serviceApiOrigin) return;
      const link = await account.request(
        `/api/v1/account/files/${file.id}/link`,
        fileLinkSchema,
        "POST",
        { expectedRevision: file.revision },
      );
      const target = new URL(link.url);
      if (
        target.origin !== serviceApiOrigin ||
        target.username ||
        target.password ||
        target.hash ||
        target.pathname !== `/api/v1/account/files/${file.id}/download` ||
        target.searchParams.getAll("token").length !== 1 ||
        Date.parse(link.expiresAt) <= Date.now()
      )
        throw new Error("The diagnostic download link is invalid or expired.");
      fileDownloadQuerySchema.parse(Object.fromEntries(target.searchParams));
      const snapshot = await account.request(
        `${target.pathname}${target.search}` as `/api/v1/${string}`,
        diagnosticSnapshotSchema,
      );
      const json = JSON.stringify(snapshot, null, 2);
      if (
        new TextEncoder().encode(json).byteLength > SUPPORT_LIMITS.maxFileBytes
      )
        throw new Error("The diagnostic exceeds its download limit.");
      const url = URL.createObjectURL(
        new Blob([json], { type: "application/json" }),
      );
      urls.current.add(url);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "tholi-diagnostic.json";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        urls.current.delete(url);
      }, 10000);
      setNotice(
        "Your diagnostic download has started. It has not been attached to a support request.",
      );
    });
  const available =
    file?.status === "ready" && Date.parse(file.expiresAt) > Date.now();
  return (
    <section
      className="contact-diagnostic"
      aria-labelledby="contact-diagnostic-title"
      aria-busy={busy}
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
          disabled={busy}
          onClick={() => void create()}
        >
          {file ? "Create another diagnostic" : "Create account diagnostic"}
        </button>
        {file && (
          <button
            className="web-secondary"
            type="button"
            disabled={busy}
            onClick={() => void check()}
          >
            Check diagnostic status
          </button>
        )}
        {available && (
          <button
            className="web-primary"
            type="button"
            disabled={busy}
            onClick={() => void download()}
          >
            Download diagnostic
          </button>
        )}
      </div>
      {busy && (
        <p role="status">Working on your account diagnostic. Please wait.</p>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className="contact-field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
