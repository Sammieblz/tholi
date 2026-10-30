# VM API delivery profile

This overlay reuses the root API image, private services and service configuration.
It configures network delivery only. Production identity endpoints, HTTPS web/API
origins, secure cookies, secrets, database backup and object lifecycle policies
must be configured separately before exposing it. The local OIDC development
realm is not a production identity configuration.

The root Compose file fixes local API and worker environment values, including
`NODE_ENV`, HTTP identity endpoints and local origins. Adding different values to
an `--env-file` does not replace those fixed settings. Supply a separate
production API/worker Compose override, or equivalent orchestrator configuration,
using the existing [service configuration](../../docs/development/service-api.md)
and [identity configuration](../../docs/development/service-identity.md). Include
that operator-owned override in the commands below when reviewing a complete
production deployment. The commands shown here validate only this delivery
overlay against the local base.

Use Docker Compose **2.24.4 or newer** for the `!override` ports and mounts. The
overlay replaces the four local gateway ports with HTTP 80 and HTTPS 443. It does
not publish PostgreSQL, SMTP/mail capture, S3 or the identity admin interface.

1. Replace `api.example.test` in [nginx.conf](nginx.conf) with the actual API
   hostname. Keep exact hostname matching and the default rejection servers.
2. Obtain an operator-issued certificate for that hostname. Put `fullchain.pem`
   and `privkey.pem` in a directory outside the repository. Set its owner/group
   and permissions so gateway UID/GID `101:101` can read them, while other host
   users cannot. For example, on a dedicated Linux host use group `101`, directory
   mode `0750`, and key mode `0640`. Do not commit private keys.
3. Set `THOLI_TLS_DIRECTORY` to the absolute certificate directory in the
   operator environment. Keep service credentials in the existing protected env
   file or deployment secret store. Set the real OIDC issuer/callbacks and
   API/web origins in the separate production API/worker configuration.
4. Resolve and review the combined configuration before startup:

   ```sh
   docker compose --env-file /protected/tholi.env -f compose.yaml -f infra/vm/compose.gateway.yaml config --quiet
   ```

5. After the separately authorized deployment starts the same services, validate
   the mounted certificate and proxy configuration:

   ```sh
   docker compose --env-file /protected/tholi.env -f compose.yaml -f infra/vm/compose.gateway.yaml exec gateway nginx -t
   ```

Renew the mounted certificate in place, run `nginx -t`, then use `nginx -s reload`
through the same Compose invocation. Verify HTTPS with normal certificate
validation. Do not deploy the synthetic `api.example.test` QA certificate.

The shared proxy policies overwrite forwarding identity, disable shared caching
and retries, enforce a 512 KiB service envelope and apply a coarse per-peer
120-request/minute budget with a 40-request burst. Application authentication,
CORS, smaller route budgets, deadlines and abuse controls still apply when the
API is reached directly. Explicit trusted-proxy settings must name only the
actual deployment proxies; this overlay does not trust arbitrary incoming chains.
