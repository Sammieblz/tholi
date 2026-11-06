import { useEffect, useId, useState } from "react";
import {
  PROVIDER_CATALOG_REVISION,
  PROVIDER_CATALOG_V1,
  providerConnectionSchema,
  providerConnectionsSchema,
  type ProviderConnection,
  type ProviderDefinition,
} from "../../../../../packages/navigation-core/contracts-providers";
import { serviceCapabilitiesSchema } from "../../../../../packages/navigation-core/contracts-service";
import { useAccount } from "./session";
import { useAccountOperation } from "./useAccountOperation";
import { AccountConfirmation } from "./AccountConfirmation";
import { accountError } from "./account-error";

const endpoint = "/api/v1/account/provider-connections" as const;

export function AccountProvidersPage() {
  const account = useAccount();
  const operation = useAccountOperation(account);
  const [items, setItems] = useState<ProviderConnection[]>([]);
  const [state, setState] = useState<
    "loading" | "ready" | "unavailable" | "error"
  >("loading");
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [writable, setWritable] = useState(false);
  const request = account.request;
  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    setItems([]);
    setWritable(false);
    setError("");
    void (async () => {
      const capabilities = await request(
        "/api/v1/capabilities",
        serviceCapabilitiesSchema,
        "GET",
        undefined,
        controller.signal,
      );
      if (!capabilities.capabilities.includes("provider-connections")) {
        if (!controller.signal.aborted) setState("unavailable");
        return;
      }
      const result = await request(
        endpoint,
        providerConnectionsSchema,
        "GET",
        undefined,
        controller.signal,
      );
      if (result.catalogRevision !== PROVIDER_CATALOG_REVISION)
        throw new Error(
          "The provider catalog changed. Reload this website before continuing.",
        );
      if (!controller.signal.aborted) {
        setWritable(
          capabilities.capabilities.includes("provider-connections-write"),
        );
        setItems(result.items);
        setState("ready");
      }
    })().catch((failure: unknown) => {
      if (!controller.signal.aborted) {
        setState("error");
        setError(accountError(failure));
      }
    });
    return () => controller.abort();
  }, [request, refresh]);
  const changed = (result: ProviderConnection) =>
    setItems((previous) => [
      ...previous.filter((item) => item.id !== result.id),
      result,
    ]);
  return (
    <section
      aria-labelledby="account-providers-title"
      aria-busy={state === "loading" || operation.busy}
    >
      <header>
        <p className="eyebrow">YOUR PROVIDER</p>
        <h1 id="account-providers-title">AI connections</h1>
        <p>
          Use your own provider account for cloud guidance. Local Tholi remains
          available without a key or account.
        </p>
      </header>
      <p>
        Provider charges belong to your provider account. Tholi does not spend
        managed credits for these requests. Development request limits still
        apply.
      </p>
      <p>
        Keys are encrypted on the Tholi service and never sent to the extension.
        Saving a key makes no provider request. A connection stays unverified
        until an explicit guidance request succeeds.
      </p>
      <p role="status" aria-live="polite">
        {state === "loading"
          ? "Loading your AI connections."
          : operation.notice}
      </p>
      {(error || operation.error) && (
        <p role="alert" className="auth-error">
          {error || operation.error} Refresh connections before submitting a key
          again.
        </p>
      )}
      {state === "unavailable" && (
        <p>
          AI connections are not enabled on this service. Your local guidance
          and account data remain available.
        </p>
      )}
      {state === "ready" && !writable && (
        <p>
          Key storage is disabled on this service. You can still inspect and
          remove existing connections.
        </p>
      )}
      <div className="account-actions">
        <button
          type="button"
          disabled={state === "loading" || operation.busy}
          onClick={() => {
            operation.resetFeedback();
            setRefresh((value) => value + 1);
          }}
        >
          Refresh connections
        </button>
      </div>
      {state === "ready" &&
        Object.values(PROVIDER_CATALOG_V1).map((definition) => {
          const connection = items.find(
            (item) => item.provider === definition.provider,
          );
          return (
            <ProviderConnectionForm
              key={`${definition.provider}:${connection?.revision ?? "new"}`}
              definition={definition}
              connection={connection}
              busy={operation.busy}
              writable={writable}
              onSave={(apiKey, model) => {
                void operation.run(
                  (signal) =>
                    request(
                      connection ? `${endpoint}/${connection.id}` : endpoint,
                      providerConnectionSchema,
                      connection ? "PATCH" : "POST",
                      connection
                        ? {
                            expectedRevision: connection.revision,
                            apiKey,
                            model,
                            catalogRevision: PROVIDER_CATALOG_REVISION,
                          }
                        : {
                            provider: definition.provider,
                            apiKey,
                            model,
                            catalogRevision: PROVIDER_CATALOG_REVISION,
                          },
                      signal,
                    ),
                  changed,
                  "Connection saved. No provider request was made.",
                );
              }}
              onRemove={() => {
                if (connection)
                  void operation.run(
                    (signal) =>
                      request(
                        `${endpoint}/${connection.id}`,
                        providerConnectionSchema,
                        "DELETE",
                        { expectedRevision: connection.revision },
                        signal,
                      ),
                    changed,
                    "The stored key was removed from Tholi. It was not revoked at the provider.",
                  );
              }}
            />
          );
        })}
    </section>
  );
}

function ProviderConnectionForm({
  definition,
  connection,
  busy,
  writable,
  onSave,
  onRemove,
}: {
  definition: ProviderDefinition;
  connection?: ProviderConnection;
  busy: boolean;
  writable: boolean;
  onSave(key: string, model: string): void;
  onRemove(): void;
}) {
  const id = useId();
  const active = connection?.status === "active";
  return (
    <section className="account-provider" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{definition.label}</h2>
      <p id={`${id}-privacy`}>
        {definition.provider === "openrouter"
          ? "Guidance is processed by OpenRouter and its approved Anthropic upstream. Fallback routing is disabled and data collection is denied in routing requests. This does not promise verified zero retention."
          : `Guidance is sent to ${definition.label} under that provider's terms and retention settings.`}
      </p>
      <p>
        {active
          ? connection.verifiedAt
            ? "Verified by a successful guidance request."
            : "Saved, unverified."
          : connection
            ? "Disconnected from Tholi."
            : "No key saved."}
      </p>
      <form
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const values = new FormData(form);
          const apiKey = String(values.get("apiKey") ?? "");
          const model = String(values.get("model") ?? "");
          form.reset();
          if (!busy && apiKey && model === definition.model)
            onSave(apiKey, model);
        }}
      >
        <fieldset
          className="account-provider-fields"
          disabled={busy || !writable}
        >
          <legend className="sr-only">
            {active ? "Replace" : "Save"} your {definition.label} key
          </legend>
          <label htmlFor={`${id}-model`}>Model</label>
          <select id={`${id}-model`} name="model" required defaultValue="">
            <option value="" disabled>
              Choose the approved model
            </option>
            <option value={definition.model}>{definition.model}</option>
          </select>
          <label htmlFor={`${id}-key`}>
            {active ? "Replacement API key" : "API key"}
          </label>
          <input
            id={`${id}-key`}
            name="apiKey"
            type="password"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
            maxLength={8192}
            aria-describedby={`${id}-privacy`}
          />
          <div className="account-actions">
            <button type="submit">
              {active ? "Replace key" : "Save connection"}
            </button>
          </div>
        </fieldset>
      </form>
      {connection && connection.status !== "removed" && (
        <AccountConfirmation
          title={`Remove ${definition.label} from Tholi?`}
          description="This disables this connection and deletes its stored key. To revoke the key itself, use your provider's dashboard."
          label="Remove from Tholi"
          confirmLabel="Remove connection"
          busy={busy}
          onConfirm={onRemove}
        />
      )}
    </section>
  );
}
