import { useEffect, useRef, useState, type FormEvent } from "react";
import { Archive, ChatBubble, Map, Palette, Search } from "iconoir-react";
import {
  savedDataArtifactSchema,
  SAVED_DATA_LIMITS,
  type SavedDataArtifact,
  type SavedDataRecord,
} from "../../../../../packages/navigation-core/contracts-saved-data";
import {
  emptySavedDataClientState,
  savedDataOperationIds,
} from "../../../../../packages/navigation-core/saved-data-client";
import { serviceCapabilitiesSchema } from "../../../../../packages/navigation-core/contracts-service";
import { AccountConfirmation } from "./AccountConfirmation";
import { AccountFileDelivery } from "./AccountFileDelivery";
import { accountError } from "./account-error";
import { useAccount } from "./session";
import "./saved-data.css";

const kinds = {
  saved_route: { label: "Saved routes", Icon: Map },
  site_knowledge: { label: "Website knowledge", Icon: Archive },
  conversation_excerpt: { label: "Conversation excerpts", Icon: ChatBubble },
  preferences: { label: "Preferences", Icon: Palette },
};
type Filters = { query: string; kind: string; folder: string; tag: string };
const emptyFilters: Filters = { query: "", kind: "", folder: "", tag: "" };
/** Cloud records are managed through the existing account-scoped client only. */
export function SavedDataPage() {
  const account = useAccount(),
    client = account.savedData,
    identity = account.session
      ? `${account.session.account.id}/${account.session.account.workspaceId}/${account.session.session.id}`
      : "";
  const [items, setItems] = useState<SavedDataRecord[]>([]),
    [cache, setCache] = useState(emptySavedDataClientState),
    [draft, setDraft] = useState(emptyFilters),
    [filters, setFilters] = useState(emptyFilters),
    [cursors, setCursors] = useState<(string | undefined)[]>([undefined]),
    [nextCursor, setNextCursor] = useState<string>(),
    [selected, setSelected] = useState<string[]>([]),
    [detail, setDetail] = useState<SavedDataRecord>(),
    [busy, setBusy] = useState(false),
    [writeAvailability, setWriteAvailability] = useState<
      "checking" | "available" | "unavailable" | "error"
    >("checking"),
    [displayIdentity, setDisplayIdentity] = useState(identity),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [fileId, setFileId] = useState<string>();
  const generation = useRef(0),
    currentIdentity = useRef(identity),
    detailTarget = useRef<string | undefined>(undefined),
    restoreOpener = useRef(false),
    listHeading = useRef<HTMLHeadingElement>(null),
    heading = useRef<HTMLHeadingElement>(null),
    opener = useRef<HTMLButtonElement | null>(null);
  if (currentIdentity.current !== identity) {
    currentIdentity.current = identity;
    generation.current++;
  }
  async function perform<T>(
    operation: () => Promise<T>,
    apply: (value: T) => void,
    message = "",
  ) {
    const stamp = ++generation.current,
      scope = currentIdentity.current,
      current = () =>
        generation.current === stamp && currentIdentity.current === scope;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const value = await operation();
      if (current()) {
        apply(value);
        setNotice(message);
      }
    } catch (failure) {
      if (current())
        setError(
          accountError(
            failure,
            "The request could not be confirmed. Check your connection and review pending changes before trying again.",
          ),
        );
    } finally {
      if (!current()) return;
      const next = await client.cached().catch(() => undefined);
      if (current()) {
        if (next) setCache(next);
        setBusy(false);
      }
    }
  }
  function load(
    nextFilters: Filters,
    nextCursors: (string | undefined)[],
    detectCapabilities = false,
  ) {
    if (detectCapabilities) setWriteAvailability("checking");
    return perform(
      async () => {
        const [page, capabilities] = await Promise.allSettled([
          client.list(
            {
              limit: SAVED_DATA_LIMITS.importItems,
              cursor: nextCursors.at(-1),
              query: nextFilters.query || undefined,
              kind: nextFilters.kind || undefined,
              folder: nextFilters.folder || undefined,
              tag: nextFilters.tag || undefined,
            },
            !!nextFilters.query,
          ),
          detectCapabilities
            ? account.request("/api/v1/capabilities", serviceCapabilitiesSchema)
            : Promise.resolve(undefined),
        ]);
        return { page, capabilities };
      },
      ({ page, capabilities }) => {
        if (detectCapabilities) {
          const offered =
            capabilities.status === "fulfilled"
              ? capabilities.value
              : undefined;
          setWriteAvailability(
            !offered
              ? "error"
              : offered.capabilities.includes("saved-data-write") &&
                  offered.capabilities.includes("account-binding")
                ? "available"
                : "unavailable",
          );
        }
        if (page.status === "rejected") throw page.reason;
        setItems(page.value.items);
        setNextCursor(page.value.nextCursor);
        setFilters(nextFilters);
        setCursors(nextCursors);
        setSelected([]);
      },
    );
  }
  useEffect(() => {
    setDisplayIdentity(identity);
    setItems([]);
    setCache(emptySavedDataClientState());
    setDraft(emptyFilters);
    setFilters(emptyFilters);
    setCursors([undefined]);
    setNextCursor(undefined);
    setSelected([]);
    setDetail(undefined);
    setFileId(undefined);
    detailTarget.current = undefined;
    restoreOpener.current = false;
    opener.current = null;
    setWriteAvailability("checking");
    setError("");
    setNotice("");
    if (identity) void load(emptyFilters, [undefined], true);
    return () => {
      generation.current++;
    };
  }, [identity, client]);
  useEffect(() => {
    const active = document.activeElement;
    if (
      detail &&
      (!active ||
        active === document.body ||
        !active.isConnected ||
        active === opener.current)
    )
      heading.current?.focus();
  }, [detail?.id, detail?.revision]);
  useEffect(() => {
    if (!busy && !detail && restoreOpener.current) {
      restoreOpener.current = false;
      const active = document.activeElement;
      if (!active || active === document.body || !active.isConnected)
        (opener.current?.isConnected
          ? opener.current
          : listHeading.current
        )?.focus();
    }
  }, [busy, detail]);
  function view(id: string, button?: HTMLButtonElement) {
    if (button) opener.current = button;
    detailTarget.current = id;
    void perform(
      () => client.read(id),
      (record) => {
        if (detailTarget.current === id) setDetail(record);
      },
    );
  }
  function closeDetail() {
    detailTarget.current = undefined;
    restoreOpener.current = true;
    setDetail(undefined);
  }
  function submitFilters(event: FormEvent) {
    event.preventDefault();
    void load(
      {
        query: draft.query.trim(),
        kind: draft.kind,
        folder: draft.folder.trim(),
        tag: draft.tag.trim(),
      },
      [undefined],
    );
  }
  if (!account.configured)
    return (
      <p>
        Cloud data is not configured on this website. Your local extension data
        stays on your device.
      </p>
    );
  if (!identity)
    return (
      <p>
        Sign in to manage data you explicitly saved to the cloud. Local
        extension data is not uploaded when you sign in.
      </p>
    );
  if (displayIdentity !== identity)
    return <p role="status">Opening the current account's saved data.</p>;
  const canWrite = writeAvailability === "available";
  const blocked =
    detail &&
    cache.outbox.some((entry) =>
      savedDataOperationIds(entry.operation).includes(detail.id),
    );
  return (
    <section
      className="saved-data"
      aria-labelledby="saved-data-title"
      aria-busy={busy}
    >
      <header>
        <p className="eyebrow">YOUR CLOUD WORKSPACE</p>
        <h1 id="saved-data-title" ref={listHeading} tabIndex={-1}>
          Saved data
        </h1>
        <p>
          Review and organize the data you chose to save. Signing in does not
          upload your local routes, website knowledge or conversations.
        </p>
      </header>
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="saved-data-status"
      >
        {busy ? "Loading your saved data." : notice}
      </p>
      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}
      {writeAvailability === "error" && (
        <p role="alert" className="auth-error">
          Editing availability could not be checked. Use Refresh list to try
          again.
        </p>
      )}
      <form
        className="saved-data-filters"
        aria-label="Filter saved data"
        onSubmit={submitFilters}
      >
        <label className="saved-data-search">
          Search saved data
          <span>
            <Search aria-hidden="true" />
            <input
              type="search"
              value={draft.query}
              maxLength={80}
              onChange={(event) =>
                setDraft({ ...draft, query: event.target.value })
              }
            />
          </span>
        </label>
        <label>
          Type
          <select
            value={draft.kind}
            onChange={(event) =>
              setDraft({ ...draft, kind: event.target.value })
            }
          >
            <option value="">All types</option>
            {Object.entries(kinds).map(([kind, value]) => (
              <option key={kind} value={kind}>
                {value.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Folder
          <input
            value={draft.folder}
            maxLength={SAVED_DATA_LIMITS.folder}
            onChange={(event) =>
              setDraft({ ...draft, folder: event.target.value })
            }
          />
        </label>
        <label>
          Tag
          <input
            value={draft.tag}
            maxLength={SAVED_DATA_LIMITS.tag}
            onChange={(event) =>
              setDraft({ ...draft, tag: event.target.value })
            }
          />
        </label>
        <button type="submit" disabled={busy}>
          Apply filters
        </button>
      </form>
      <div className="saved-data-toolbar">
        <p>
          {selected.length
            ? `${selected.length} selected`
            : "Select items to export."}
        </p>
        <button
          disabled={busy || !selected.length}
          onClick={() =>
            void perform(
              () => client.export(selected),
              (result) => setFileId(result.fileId),
              "Your export was requested.",
            )
          }
        >
          Export selected
        </button>
        <button
          disabled={busy}
          onClick={() =>
            void load(filters, cursors, writeAvailability === "error")
          }
        >
          Refresh list
        </button>
      </div>
      <AccountFileDelivery
        account={account}
        fileId={fileId}
        format="saved-data"
      />
      {!busy && !items.length && (
        <p className="saved-data-empty">
          No matching cloud data. Save selected data from the extension to see
          it here.
        </p>
      )}
      <ul className="saved-data-list" aria-label="Saved items">
        {items.map((item) => {
          const { Icon, label } = kinds[item.kind];
          return (
            <li key={item.id}>
              <label className="saved-data-select">
                <input
                  type="checkbox"
                  checked={selected.includes(item.id)}
                  disabled={busy}
                  aria-label={`Select ${item.metadata.label}`}
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? [...selected, item.id]
                        : selected.filter((id) => id !== item.id),
                    )
                  }
                />
              </label>
              <Icon aria-hidden="true" />
              <div>
                <strong>{item.metadata.label}</strong>
                <p>
                  {label}
                  {item.metadata.folder ? ` · ${item.metadata.folder}` : ""}
                </p>
                {!!item.metadata.tags.length && (
                  <p>{item.metadata.tags.join(", ")}</p>
                )}
              </div>
              <button
                disabled={busy}
                onClick={(event) => view(item.id, event.currentTarget)}
                aria-label={`View ${item.metadata.label}`}
              >
                View
              </button>
            </li>
          );
        })}
      </ul>
      <nav className="saved-data-pagination" aria-label="Saved data pages">
        <button
          disabled={busy || cursors.length === 1}
          onClick={() => void load(filters, cursors.slice(0, -1))}
        >
          Previous page
        </button>
        <span>Page {cursors.length}</span>
        <button
          disabled={busy || !nextCursor}
          onClick={() => void load(filters, [...cursors, nextCursor])}
        >
          Next page
        </button>
      </nav>
      {!!cache.outbox.length && (
        <section
          className="saved-data-pending"
          aria-labelledby="saved-data-pending-title"
        >
          <h2 id="saved-data-pending-title">Pending changes</h2>
          <p>
            A disconnected request may already have reached the service.
            Reconcile uses the original operation identifiers. Conflicting
            changes need your review.
          </p>
          <button
            disabled={
              busy ||
              (!canWrite &&
                cache.outbox.some((entry) => entry.operation.kind !== "delete"))
            }
            onClick={() =>
              void perform(
                () => client.reconcile(),
                () => {},
                "Pending changes were checked. Review any remaining conflicts.",
              )
            }
          >
            Reconcile pending changes
          </button>
          <ul>
            {cache.outbox.map((entry) => (
              <li key={entry.operation.body.idempotencyKey}>
                <div>
                  <strong>
                    {entry.operation.kind === "import"
                      ? `Import ${entry.operation.body.items.length} selected items`
                      : entry.operation.kind === "save"
                        ? entry.operation.body.artifact.metadata.label
                        : "Delete selected item"}
                  </strong>
                  <p>
                    {entry.state === "conflict"
                      ? "Changed or deleted in the cloud"
                      : "Not yet confirmed"}
                  </p>
                </div>
                {entry.state === "conflict" && (
                  <AccountConfirmation
                    title="Keep the current cloud version?"
                    description="Discard this pending change from this browser. This does not erase local extension data or restore a deleted cloud item."
                    label="Keep cloud version"
                    busy={busy}
                    onConfirm={() =>
                      void perform(
                        () =>
                          client.discardConflict(
                            entry.operation.body.idempotencyKey,
                          ),
                        () => {},
                        "The conflicting pending change was discarded.",
                      )
                    }
                  />
                )}
                {savedDataOperationIds(entry.operation).length === 1 && (
                  <button
                    disabled={busy}
                    onClick={(event) =>
                      view(
                        savedDataOperationIds(entry.operation)[0],
                        event.currentTarget,
                      )
                    }
                  >
                    Review cloud item
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {detail && (
        <section
          className="saved-data-detail"
          aria-labelledby="saved-data-detail-title"
        >
          <div className="saved-data-detail-heading">
            <h2 id="saved-data-detail-title" tabIndex={-1} ref={heading}>
              {detail.deletedAt ? "Deleted cloud item" : detail.metadata.label}
            </h2>
            <button onClick={closeDetail}>Close details</button>
          </div>
          {detail.deletedAt || !detail.data ? (
            <p>
              This cloud item was deleted. It cannot be restored by replaying an
              older change.
            </p>
          ) : (
            <>
              <SavedContent record={detail} />
              {writeAvailability === "unavailable" && (
                <p>
                  Editing is unavailable on this service. You can still review
                  your saved data. Export and deletion depend on your current
                  permissions.
                </p>
              )}
              {blocked && (
                <p>
                  Review the pending change for this item before editing or
                  deleting it again.
                </p>
              )}
              <SavedEditor
                key={`${detail.id}/${detail.revision}`}
                record={detail}
                busy={busy || !!blocked || !canWrite}
                onSave={(artifact) =>
                  void perform(
                    async () => {
                      await client.save(artifact, detail.revision);
                      return client.read(detail.id);
                    },
                    (record) => {
                      if (detailTarget.current === record.id) setDetail(record);
                      setItems((rows) =>
                        rows.map((row) =>
                          row.id === record.id ? record : row,
                        ),
                      );
                    },
                    "Your cloud item was saved.",
                  )
                }
              />
              <AccountConfirmation
                title={`Delete ${detail.metadata.label}?`}
                description="Delete this cloud item. Your local extension data remains on your device. Older offline changes cannot restore this item."
                label="Delete cloud item"
                busy={busy || !!blocked}
                onConfirm={() =>
                  void perform(
                    async () => {
                      await client.remove(detail.id, detail.revision);
                      return client.read(detail.id);
                    },
                    (record) => {
                      if (detailTarget.current === record.id) setDetail(record);
                      setItems((rows) =>
                        rows.filter((row) => row.id !== record.id),
                      );
                      setSelected((ids) =>
                        ids.filter((id) => id !== record.id),
                      );
                    },
                    "The cloud item was deleted.",
                  )
                }
              />
            </>
          )}
        </section>
      )}
    </section>
  );
}

function SavedContent({ record }: { record: SavedDataRecord }) {
  if (!record.data) return null;
  if (record.kind === "saved_route")
    return (
      <div className="saved-data-content">
        <p>{record.data.origin}</p>
        <p>{record.data.goal}</p>
        <p>
          Saved steps describe a past route. They do not establish progress in a
          new task.
        </p>
        <ol>
          {record.data.steps.map((step, index) => (
            <li key={index}>{step.label}</li>
          ))}
        </ol>
      </div>
    );
  if (record.kind === "site_knowledge")
    return (
      <div className="saved-data-content">
        <p>{record.data.origin}</p>
        <ul>
          {record.data.controls.map((control, index) => (
            <li key={index}>
              <strong>{control.label}</strong> <span>{control.role}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  if (record.kind === "conversation_excerpt")
    return (
      <ol className="saved-data-content saved-data-conversation">
        {record.data.messages.map((message, index) => (
          <li key={index}>
            <strong>{message.role === "user" ? "You" : "Tholi"}</strong>
            <p>{message.text}</p>
          </li>
        ))}
      </ol>
    );
  return (
    <p>
      Saved website appearance: {record.data.websiteAppearance}. Editing this
      saved preference does not change this browser's theme.
    </p>
  );
}

function SavedEditor({
  record,
  busy,
  onSave,
}: {
  record: SavedDataRecord;
  busy: boolean;
  onSave: (artifact: SavedDataArtifact) => void;
}) {
  const [label, setLabel] = useState(record.metadata.label),
    [folder, setFolder] = useState(record.metadata.folder ?? ""),
    [tags, setTags] = useState(record.metadata.tags.join(", ")),
    [goal, setGoal] = useState(
      record.kind === "saved_route" ? (record.data?.goal ?? "") : "",
    ),
    [appearance, setAppearance] = useState(
      record.kind === "preferences"
        ? (record.data?.websiteAppearance ?? "light")
        : "light",
    ),
    [invalid, setInvalid] = useState("");
  const validation = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (invalid) validation.current?.focus();
  }, [invalid]);
  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = savedDataArtifactSchema.safeParse({
      id: record.id,
      schemaVersion: record.schemaVersion,
      kind: record.kind,
      metadata: {
        label: label.trim(),
        folder: folder.trim() || null,
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      },
      data:
        record.kind === "saved_route"
          ? { ...record.data, goal: goal.trim() }
          : record.kind === "preferences"
            ? { websiteAppearance: appearance }
            : record.data,
    });
    if (!parsed.success) {
      setInvalid(
        "Check your label, folder, tags and editable content. Use distinct tags and remove sensitive values before saving.",
      );
      return;
    }
    setInvalid("");
    onSave(parsed.data);
  }
  return (
    <form
      className="saved-data-editor"
      aria-label="Edit saved item"
      onSubmit={submit}
    >
      <fieldset disabled={busy}>
        <legend>Edit saved item</legend>
        <label>
          Label
          <input
            required
            maxLength={SAVED_DATA_LIMITS.label}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        <label>
          Folder
          <input
            maxLength={SAVED_DATA_LIMITS.folder}
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
          />
        </label>
        <label>
          Tags
          <span className="saved-data-hint" id="saved-tags-hint">
            Up to 10 distinct tags, separated by commas. Each tag can contain up
            to 40 characters.
          </span>
          <input
            aria-describedby="saved-tags-hint"
            value={tags}
            maxLength={SAVED_DATA_LIMITS.tags * (SAVED_DATA_LIMITS.tag + 2)}
            onChange={(event) => setTags(event.target.value)}
          />
        </label>
        {record.kind === "saved_route" && (
          <label>
            Destination
            <textarea
              required
              maxLength={1000}
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
            />
          </label>
        )}
        {record.kind === "preferences" && (
          <label>
            Saved website appearance
            <select
              value={appearance}
              onChange={(event) =>
                setAppearance(event.target.value as "light" | "dark")
              }
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        )}
        {invalid && (
          <p role="alert" className="auth-error" ref={validation} tabIndex={-1}>
            {invalid}
          </p>
        )}
        <button type="submit">Save cloud changes</button>
      </fieldset>
    </form>
  );
}
