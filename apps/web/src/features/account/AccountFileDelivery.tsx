import { useEffect, useRef, useState } from "react";
import {
  SUPPORT_LIMITS,
  diagnosticSnapshotSchema,
  fileDownloadQuerySchema,
  fileLinkSchema,
  privateFileSchema,
  type PrivateFile,
} from "../../../../../packages/navigation-core/contracts-support";
import {
  SAVED_DATA_LIMITS,
  savedDataExportSnapshotSchema,
} from "../../../../../packages/navigation-core/contracts-saved-data";
import { serviceApiOrigin } from "../../config/project";
import type { useAccount } from "./session";
import { accountError } from "./account-error";
import {
  accountExportManifestSchema,
  accountExportPartSchema,
  type AccountExportManifest,
} from "../../../../../packages/navigation-core/contracts-account";
import type { z } from "zod";

const formats = {
  diagnostic: {
    name: "diagnostic",
    filename: "tholi-diagnostic.json",
    schema: diagnosticSnapshotSchema,
    maxBytes: SUPPORT_LIMITS.maxFileBytes,
    ready: "Your diagnostic is ready to download.",
  },
  "saved-data": {
    name: "saved items",
    filename: "tholi-saved-data.json",
    schema: savedDataExportSnapshotSchema,
    maxBytes: SAVED_DATA_LIMITS.importBytes,
    ready: "Your saved items are ready to download.",
  },
  "account-manifest": {
    name: "account export manifest",
    filename: "tholi-account-manifest.json",
    schema: accountExportManifestSchema,
    maxBytes: SUPPORT_LIMITS.maxFileBytes,
    ready: "Your account export manifest is ready to download.",
  },
  "account-part": {
    name: "account export file",
    filename: "tholi-account-data.json",
    schema: accountExportPartSchema,
    maxBytes: SUPPORT_LIMITS.maxFileBytes,
    ready: "This account export file is ready to download.",
  },
} as const;

type Account = ReturnType<typeof useAccount>;
export const accountFileMetadata = async (
  account: Account,
  fileId: string,
  signal: AbortSignal,
) => {
  const file = await account.request(
    `/api/v1/account/files/${fileId}`,
    privateFileSchema,
    "GET",
    undefined,
    signal,
  );
  if (file.id !== fileId) throw new Error("The private file changed.");
  return file;
};

type ExportExpectation = {
  generation: string;
  part?: AccountExportManifest["parts"][number];
};

/** Previewing a manifest and downloading a file use the same protected delivery checks. */
export async function readAccountFile<T>(
  account: Account,
  file: PrivateFile,
  schema: z.ZodType<T>,
  maxBytes: number,
  signal: AbortSignal,
  expected?: ExportExpectation,
): Promise<T> {
  if (
    !serviceApiOrigin ||
    file.status !== "ready" ||
    Date.parse(file.expiresAt) <= Date.now()
  )
    throw new Error("The private file is unavailable.");
  const link = await account.request(
    `/api/v1/account/files/${file.id}/link`,
    fileLinkSchema,
    "POST",
    { expectedRevision: file.revision },
    signal,
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
    throw new Error("Invalid private-file link.");
  fileDownloadQuerySchema.parse(Object.fromEntries(target.searchParams));
  const snapshot = await account.request(
    `${target.pathname}${target.search}` as `/api/v1/${string}`,
    schema,
    "GET",
    undefined,
    signal,
  );
  signal.throwIfAborted();
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  if (bytes.byteLength > maxBytes)
    throw new Error("Private file exceeds its limit.");
  if (
    snapshot &&
    typeof snapshot === "object" &&
    "kind" in snapshot &&
    (snapshot.kind === "account-export-manifest" ||
      snapshot.kind === "account-export-part")
  ) {
    const value =
      snapshot.kind === "account-export-manifest"
        ? accountExportManifestSchema.parse(snapshot)
        : accountExportPartSchema.parse(snapshot);
    if (
      value.accountId !== account.session?.account.id ||
      (expected && value.generation !== expected.generation)
    )
      throw new Error("The export belongs to another account view.");
    if (expected?.part) {
      const part = expected.part;
      if (
        value.kind !== "account-export-part" ||
        file.id !== part.fileId ||
        value.section !== part.section ||
        value.workspaceId !== part.workspaceId ||
        value.items.length !== part.count ||
        bytes.byteLength !== part.bytes
      )
        throw new Error("The export file does not match its index.");
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const hash = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      signal.throwIfAborted();
      if (hash !== part.sha256)
        throw new Error("The export file does not match its index.");
    }
  } else if (expected) throw new Error("The account export format changed.");
  return snapshot;
}

/** One explicit private-file delivery path, separate from creating an export. */
export function AccountFileDelivery({
  account,
  fileId,
  format,
  label,
  expected,
}: {
  account: Account;
  fileId?: string;
  format: keyof typeof formats;
  label?: string;
  expected?: ExportExpectation;
}) {
  const [file, setFile] = useState<PrivateFile>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const lifetime = useRef(new AbortController());
  const urls = useRef(new Set<string>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const actor = account.session?.account.id;
  const workspace = account.session?.account.workspaceId;
  const session = account.session?.session.id;
  const requestFile = account.request;
  const selected = formats[format];
  const name = label ?? selected.name;

  useEffect(() => {
    lifetime.current.abort();
    const next = new AbortController();
    lifetime.current = next;
    setFile(undefined);
    setError("");
    setNotice("");
    setBusy(false);
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current.clear();
    for (const timer of timers.current) clearTimeout(timer);
    timers.current.clear();
    if (actor && fileId) {
      setBusy(true);
      void accountFileMetadata(account, fileId, next.signal)
        .then((metadata) => {
          if (!next.signal.aborted) setFile(metadata);
        })
        .catch((failure: unknown) => {
          if (!next.signal.aborted) setError(accountError(failure));
        })
        .finally(() => {
          if (!next.signal.aborted) setBusy(false);
        });
    }
    return () => {
      next.abort();
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current.clear();
      for (const timer of timers.current) clearTimeout(timer);
      timers.current.clear();
    };
  }, [actor, workspace, session, fileId, requestFile]);

  const perform = async (
    action: (current: () => void, signal: AbortSignal) => Promise<void>,
  ) => {
    const captured = lifetime.current;
    const current = () => {
      captured.signal.throwIfAborted();
      if (captured !== lifetime.current)
        throw new Error("Account view changed.");
    };
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action(current, captured.signal);
    } catch (failure) {
      if (!captured.signal.aborted) setError(accountError(failure));
    } finally {
      if (!captured.signal.aborted) setBusy(false);
    }
  };
  const check = () =>
    perform(async (current, signal) => {
      if (!fileId) return;
      const metadata = await accountFileMetadata(account, fileId, signal);
      current();
      setFile(metadata);
    });
  const download = () =>
    perform(async (current, signal) => {
      if (!file) return;
      const snapshot = await readAccountFile<unknown>(
        account,
        file,
        selected.schema,
        selected.maxBytes,
        signal,
        expected,
      );
      current();
      const json = JSON.stringify(snapshot);
      const url = URL.createObjectURL(
        new Blob([json], { type: "application/json" }),
      );
      urls.current.add(url);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = format.startsWith("account-")
        ? `tholi-${format}-${file.id}.json`
        : selected.filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      const timer = setTimeout(() => {
        URL.revokeObjectURL(url);
        urls.current.delete(url);
        timers.current.delete(timer);
      }, 10000);
      timers.current.add(timer);
      setNotice(
        "Your download has started. Keep the downloaded copy somewhere private.",
      );
    });
  if (!fileId) return null;
  const available =
    file?.status === "ready" && Date.parse(file.expiresAt) > Date.now();
  return (
    <div className="account-file" aria-busy={busy}>
      <p role="status">
        {busy
          ? "Working on your private file."
          : notice ||
            (available
              ? selected.ready
              : file?.status === "pending"
                ? "Your export is queued. Check its status in a moment."
                : file
                  ? "This file is no longer available. Request a new export if you need it."
                  : "Review the file status before downloading.")}
      </p>
      <div className="account-actions">
        <button
          type="button"
          className="web-secondary"
          disabled={busy || !actor}
          onClick={() => void check()}
        >
          Check {name} status
        </button>
        {available && (
          <button
            type="button"
            className="web-primary"
            disabled={busy || !actor}
            onClick={() => void download()}
          >
            Download {name}
          </button>
        )}
      </div>
      {file && (
        <p className="small">
          Private file expires{" "}
          <time dateTime={file.expiresAt}>
            {new Date(file.expiresAt).toLocaleString()}
          </time>
          . Download links also require your signed-in account.
        </p>
      )}
      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}
    </div>
  );
}
