# Privacy and permissions

Local guidance runs without a Tholi account. Choose which
websites Tholi can access and use its data controls when you want to forget
something.

## Allow website access

1. Open the website where you want help and select the Tholi toolbar icon.
2. Review the browser's website-access request and allow only the website you
   intend to use.
3. If a task reaches another website, review any new request before continuing.

Installation does not grant access to every website. Declining access leaves
that website unavailable for guidance. You can review or revoke access in the
browser's extension settings. Restricted browser pages cannot be guided.

## What Tholi uses

Tholi reads page controls, labels and headings to suggest a next step. Normal
guidance processes this context on your device. Visual assistance can use
temporary screenshots when available; editable fields and embedded frames are
masked. Tholi cannot promise to identify every sensitive label on every page.

Enter passwords, verification codes and other private form values directly on
the website. You remain responsible for signing in and reviewing purchases,
deletions, submissions and other consequential actions.

Tholi can keep reusable website knowledge and saved routes in this browser.
Task details, drafts and conversation are session information. They do not
automatically synchronize to the Tholi website or between your browsers. Signing
in does not upload your local collection.

## Forget routes or website memory

Open **Tholi settings** and enable **Advanced controls** if needed.

- In **Saved routes**, use **Forget route** to remove one reusable route.
- Under **Your data**, choose **Forget this website** to delete its learned
  knowledge and reusable routes. Active guidance on it stops.
- Choose **Clear all site memory** to remove learned knowledge and reusable
  routes for all websites. Review the confirmation before continuing.
- **Reset current session** clears tasks, the draft and conversation. It keeps
  saved website knowledge and routes.

## Optional private connections

You do not need a backend connection for normal use. If you choose to connect
your own private backend, the extension explains the data it sends before you
enable it. Sending temporary masked images is a separate option. Firefox also
requests data-transmission consent for an enabled connection.

If a connected backend is offline during deletion, reconnect and retry the
failed deletion. Disabling a connection or revoking access does not erase data
already on that server. Setup details are linked from [For developers](developers.md).

## Optional AI providers

If your configured service offers **AI connections**, a signed-in account can save
a provider API key there. Keys are encrypted by the service and are not given to
the extension or displayed again. Saving a key does not make a provider request.
The service operator still processes the credential when it sends an authorized
request, so choose a service you trust.

Enabling connected guidance can send your destination, bounded website context
and, only with separate permission, a temporary masked image. OpenAI and Anthropic
connections send that information to the selected provider. OpenRouter connections
send it through OpenRouter to the approved Anthropic upstream. Provider privacy
settings and terms apply; Tholi does not promise verified zero retention. Automatic
masking cannot remove every sensitive item displayed outside editable fields.

Use **Remove from Tholi** in **AI connections** to delete the stored key. To revoke
the key itself, use your provider's dashboard. Selecting **Local** stops new connected
AI requests. Removing a key or changing a processing choice cannot recall information
already received by a provider.

## Private website learning

When available on your configured service, **Private website learning** has two
separate choices for each website. Both start off:

- **Save future website knowledge to my cloud account** permits future sanitized
  interface knowledge to be saved privately to your account and workspace.
- **Use my saved cloud knowledge for this website** permits that knowledge to be
  used as historical hints. Tholi still checks the current page and its outcomes.

Each change is saved immediately. Existing local memory is not uploaded. Provider
processing, temporary masked images and learning remain separate choices. This
feature does not publish knowledge to a community or train a shared model.

The account's **Saved data** workspace can show saved cloud knowledge and its website
controls. The extension shows controls for its current pinned website. If a change
cannot be confirmed, refresh the settings before continuing.

Turn collection off to stop saving future knowledge; turn reuse off to stop using
saved cloud hints. To remove the website's cloud knowledge, choose **Forget cloud
knowledge** and review the confirmation. If the result says more remains, explicitly
continue until completion is confirmed. Local memory, saved routes and conversation
excerpts use their own deletion controls.

Private cloud knowledge has a 90-day evidence lifetime. Editing its label does not
renew it. Expired knowledge is excluded from use; physical cleanup depends on service
maintenance, and independently retained backups may take longer. Read the full
[privacy notice](https://tholi.io/privacy) for the service and provider distinctions.

The website has separate cookies and measurements. Read the
[privacy notice](https://tholi.io/privacy) and [cookie notice](https://tholi.io/cookies)
for the full current disclosures.
