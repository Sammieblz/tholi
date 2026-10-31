# Portable identity and account sessions

The optional service identity profile extends the existing `apps/api` backend.
The website and extension use one PostgreSQL-backed session owner, with different
credential delivery adapters. Installing or using Local Tholi needs no account,
payment, identity provider or service upload. Practice remains isolated.

This milestone enables account authentication and session security. It does not
enable cloud inference, paid plans, credits or automatic synchronization of local
knowledge. Their API inventory entries remain planned.

## Local setup

1. Run `npm run local:init` for a new local environment. For an existing local
   environment, use `npm run local:init -- --upgrade-identity true`. This explicit
   upgrade appends only missing identity settings and preserves existing secrets,
   ports, users and database data.
2. Run `npm run local:up`. Dedicated initialization containers migrate the service
   schema and reconcile the owned Keycloak realm/client before the API starts.
   HTTP replicas receive runtime SQL credentials, never migration or identity
   administration credentials. No HTTP startup runs a migration or seed.
3. Run `npm run local:seed` if you want the synthetic application fixture. The
   local realm already includes its separate verified identity fixture. The
   password is generated in the private local environment file; do not log it or
   reuse it outside development.
4. Set `VITE_THOLI_SERVICE_ORIGIN=http://127.0.0.1:8788` when starting/building the
   website, with its origin matching `THOLI_WEB_ORIGIN`. Open `/signin`, `/signup`
   or `/account`. The provider owns credential entry, verification and recovery.

The API is exposed at loopback port 8788, Keycloak at `localhost:18080` and Mailpit
at `127.0.0.1:18025` by default. Changed ports remain supported. Mail capture has
no relay or external delivery. Keep the existing environment file private.
Without a configured website service origin, installation works and account
pages explain that the account service is unavailable.

Keycloak reconciliation updates only owned realm settings and the confidential
`tholi-service` client. It retains users and their credentials. The exact API
callback is `/api/v1/auth/callback`; its post-logout return is the configured
website's `/download`. Backchannel logout uses the internal API address, not a
container's loopback address.

With email verification enabled, the pinned local provider first collects profile
details, sends verification mail to Mailpit, then asks for a password after the
email link is followed. This is its
[recommended registration order](https://github.com/keycloak/keycloak/blob/26.8.1/services/src/main/java/org/keycloak/authentication/forms/RegistrationPassword.java).
Keep verification enabled and follow the displayed provider controls.

## Browser extension

Open Tholi settings and configure **Account service origin**, then choose **Save
service origin** and **Sign in** or **Sign up**. Authorization uses the native
browser identity window, with state, S256 PKCE and an exact registered callback.
The callback carries only a short-lived single-use broker code and state.
The browser background exchanges that code using its verifier.

Register the actual `identity.getRedirectURL()` result in the service's approved
client callbacks. Published Chrome and development unpacked Chrome can have
different IDs. Firefox's callback is tied to its add-on ID, separately from the
profile's `moz-extension` origin. Do not register arbitrary returns or use the
profile UUID as an OAuth callback. Repeated authorization-page GETs are supported
because Firefox may probe before opening its interactive window.

Native access and rotating refresh credentials stay in privileged extension
storage: trusted-context storage in Chromium, extension-origin IndexedDB in
Firefox. Content scripts, floating widgets, broadcasts and practice never receive
them. Account operations have their own serialization boundary and cannot block
navigation or Stop. Changing the service cancels stale requests and prevents late
credentials from being installed for the replacement origin.

Authentication requests only the service host and authentication consent. It does
not authorize page-content/image transmission or broaden website grants. Local
knowledge and legacy private-backend credentials remain separate. The separately
consented [development inference transport](service-api.md#opt-in-development-navigation-transport)
uses the same protected account owner; it does not enable hosted cloud-data plans.

## Sessions and trust

The identity adapter verifies the configured issuer, audience, RS256 signature,
expiry, nonce and verified-email requirement against a bounded trusted JWKS
source. Endpoint redirects are refused. Provider tokens are discarded after
verification. Internal account IDs come from `(issuer, subject)` and remain
independent of provider identity or email. Concurrent first login creates one
account, personal workspace and link in one transaction.

OIDC flow state is durable across replicas, expiring and bound to the browser,
client and approved return. Provider PKCE verifiers are sealed using the shared
32-byte flow key. Brokers are one-use and PKCE-bound. Keep the key consistent
across replicas. This key also derives website CSRF proofs. Rotate it during a
coordinated restart after revoking existing application sessions; outstanding
flows must restart and users must sign in again. Do not roll replicas with
different keys into the same service.

The website uses opaque HttpOnly sessions. Production cookies use `__Host-`,
Secure, Path `/` and no Domain. Development cookies have an explicit loopback
policy. Only the exact configured website origin receives credentialed CORS;
cookie mutations additionally require a session-bound CSRF token. Native origins
use bearer delivery and cannot read a website cookie session or its CSRF token.
CORS, client IDs and return intents never grant identity or entitlement.

Native access credentials default to five minutes. Both native and website
session families expire within twelve hours; website opaque BFF cookies use that
bounded session lifetime. Refresh rotates access and refresh credentials; website
CSRF proofs remain bound to the session.
Consumed refresh hashes remain available for replay detection; a replay commits
family revocation before returning denial. Every protected operation checks the
current account/session state. Session listing, device revocation and signing out
all devices are account-scoped. Signing out everywhere also advances a durable
account grant cutoff, so a login already underway cannot obtain a new session
using provider proof issued before that revocation. The cutoff includes the same
five-second issuer clock tolerance used by token verification. Proof issued in
the logout second or the following five seconds is conservatively refused; a
fresh sign-in may need to wait until six seconds after global logout. This
prevents an accepted ahead-of-service issuer clock from reviving an older grant.
Keep provider and service clocks synchronized across replicas.

Tholi logout does not silently end provider SSO. The response offers the provider's
registered logout flow, which may require confirmation. Verified signed
backchannel events revoke matching issuer/session or subject grants. Duplicate
events are bounded and deduplicated; pending broker grants are fenced against
logout races. No provider network request occurs inside a SQL transaction.

Flows expire after five minutes and native brokers after one minute. Expired
ephemeral rows are removed in bounded batches on later writes, so TTL expiry does
not promise immediate physical deletion during idle periods. Refresh history
supports session security; broader retention and privileged account erasure
remain their roadmap owners.

## VM, cloud and future desktop clients

Use the same API image and PostgreSQL schema on a VM or cloud platform. Configure
explicit `THOLI_IDENTITY_*` issuer, authorization/token/JWKS/logout endpoints,
client ID/secret, website origin, shared flow key and approved clients, alongside
`THOLI_DATABASE_URL` and `THOLI_SERVICE_PUBLIC_ORIGIN`. Optional access/session
lifetime values may shorten the bounded policy. HTTPS and Secure cookies are
required outside loopback development.

The website/API must use matching local hosts, or a shared HTTPS domain topology
such as `tholi.io` and `api.tholi.io`. An unrelated provider hostname behind a
third-party-cookie boundary is rejected; expose it through the configured API
domain or same-origin reverse proxy. Internal Keycloak token/JWKS endpoints may
differ from the browser-facing issuer locally; JWT issuer checks still use the
exact public issuer.

`THOLI_IDENTITY_CLIENTS` can explicitly configure the bounded client registry.
The local setup also supports `THOLI_IDENTITY_CHROMIUM_CALLBACKS` and
`THOLI_IDENTITY_FIREFOX_CALLBACKS`. Never register wildcard callbacks. A future
desktop client must use its own registered native/loopback return and PKCE,
protected device storage and the same server session/revocation contracts.
Authentication does not transfer journey or OS-action authority to the server.

Firebase remains an optional adapter evaluation. Its token verification and
revocation policy need a suitable adapter; it cannot be enabled merely by changing
an OIDC issuer URL. No Firebase dependency or mandatory hosted identity service
is introduced.

## Verification

Signed-token and HTTP tests cover issuer/audience/algorithm/expiry/nonce failures,
key rotation, cookie/CSRF/native boundaries, callback proof and signed backchannel
logout. Real PostgreSQL groups cover first-login concurrency, one-use records,
refresh replay, revocation, grant/logout races and bounded cleanup.

Fresh and retained Keycloak flows, verification/recovery mail, actual configured
website layouts, Chrome/Firefox native windows and permission dialogs require
their own recorded runs. They are not established by unit mocks or Chromium-only
evidence. See the existing [testing policy](testing/README.md); no archive,
production deployment or release is authorized by this milestone's PR tests.
