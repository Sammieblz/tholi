#!/bin/bash
set -euo pipefail
umask 077

: "${KC_BOOTSTRAP_ADMIN_USERNAME:?Missing local identity administrator}"
: "${KC_BOOTSTRAP_ADMIN_PASSWORD:?Missing local identity administrator password}"
: "${OIDC_TEST_PASSWORD:?Missing local test password}"

: "${THOLI_IDENTITY_CLIENT_SECRET_KEY:?Missing local identity client secret}"
: "${THOLI_SERVICE_PUBLIC_ORIGIN:?Missing local service origin}"
: "${THOLI_WEB_ORIGIN:?Missing local website origin}"
admin_url=${OIDC_ADMIN_URL:-http://localhost:8080}

# Values substituted into JSON have a restricted alphabet; no arbitrary JSON,
# remote SMTP destination or external callback is accepted by this local tool.
for token in "$OIDC_TEST_PASSWORD" "$THOLI_IDENTITY_CLIENT_SECRET_KEY"; do
  if [[ ! "$token" =~ ^[A-Za-z0-9_-]{16,128}$ ]]; then
    printf '%s\n' 'Local identity credentials must be 16-128 character URL-safe tokens.' >&2
    exit 1
  fi
done
loopback_origin() {
  [[ "$1" =~ ^http://(localhost|127\.0\.0\.1|\[::1\])(:([1-9][0-9]{0,4}))?$ ]] || return 1
  [[ -z "${BASH_REMATCH[3]:-}" || "${BASH_REMATCH[3]}" -le 65535 ]]
}
if ! loopback_origin "$THOLI_SERVICE_PUBLIC_ORIGIN" || ! loopback_origin "$THOLI_WEB_ORIGIN"; then
  printf '%s\n' 'Local identity callback origins must be exact HTTP loopback origins.' >&2
  exit 1
fi
if [[ "$admin_url" != http://oidc:8080 ]] && ! loopback_origin "$admin_url"; then
  printf '%s\n' 'Local identity administration must use the internal provider or HTTP loopback.' >&2
  exit 1
fi

config_file="/tmp/tholi-kcadm-${BASHPID}-${RANDOM}.config"
realm_file="/tmp/tholi-realm-${BASHPID}-${RANDOM}.json"
client_file="/tmp/tholi-client-${BASHPID}-${RANDOM}.json"
trap 'rm -f -- "$config_file" "$realm_file" "$client_file"' EXIT
kcadm=/opt/keycloak/bin/kcadm.sh
fail() { printf '%s\n' "$1" >&2; exit 1; }

if ! "$kcadm" config credentials --config "$config_file" \
  --server "$admin_url" --realm master \
  --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$KC_BOOTSTRAP_ADMIN_PASSWORD" \
  >/dev/null 2>&1; then
  fail 'Local identity seed authentication failed.'
fi

if ! realms=$("$kcadm" get realms --fields realm --config "$config_file" 2>/dev/null); then
  fail 'Local identity realm lookup failed.'
fi

realm=$(</opt/keycloak/data/import/tholi-local-realm.json)
placeholder='${OIDC_TEST_PASSWORD}'
realm=${realm//$placeholder/$OIDC_TEST_PASSWORD}
printf '%s\n' "$realm" > "$realm_file"
if grep -Eq '"realm"[[:space:]]*:[[:space:]]*"tholi-local"' <<<"$realms"; then
  # Keycloak's realm PUT updates top-level settings only. Users, roles and
  # clients in the representation are ignored, preserving retained accounts.
  if ! "$kcadm" update realms/tholi-local --file "$realm_file" --config "$config_file" >/dev/null 2>&1; then
    fail 'Local identity realm settings could not be reconciled.'
  fi
else
  if ! "$kcadm" create realms --file "$realm_file" --config "$config_file" >/dev/null 2>&1; then
    fail 'Local identity realm creation failed.'
  fi
fi

# One owner for the confidential application's client configuration. The realm
# import stays client-free; this runs for fresh and retained installations.
printf '{
  "clientId": "tholi-service",
  "name": "Tholi local account service",
  "enabled": true,
  "protocol": "openid-connect",
  "publicClient": false,
  "clientAuthenticatorType": "client-secret",
  "secret": "%s",
  "standardFlowEnabled": true,
  "implicitFlowEnabled": false,
  "directAccessGrantsEnabled": false,
  "serviceAccountsEnabled": false,
  "fullScopeAllowed": false,
  "redirectUris": ["%s/api/v1/auth/callback"],
  "webOrigins": [],
  "attributes": {
    "pkce.code.challenge.method": "S256",
    "post.logout.redirect.uris": "%s/download",
    "backchannel.logout.url": "http://api:8788/api/v1/auth/backchannel-logout",
    "backchannel.logout.session.required": "true",
    "backchannel.logout.revoke.offline.tokens": "true"
  }
}\n' "$THOLI_IDENTITY_CLIENT_SECRET_KEY" "$THOLI_SERVICE_PUBLIC_ORIGIN" "$THOLI_WEB_ORIGIN" > "$client_file"
if ! client_id=$("$kcadm" get clients -r tholi-local -q clientId=tholi-service --fields id --format csv --noquotes --config "$config_file" 2>/dev/null); then
  fail 'Local identity client lookup failed.'
fi
client_id=${client_id//$'\r'/}
if [[ -n "$client_id" ]]; then
  [[ "$client_id" =~ ^[a-fA-F0-9-]{36}$ ]] || fail 'Local identity client lookup was ambiguous.'
  if ! "$kcadm" update "clients/$client_id" -r tholi-local --file "$client_file" --config "$config_file" >/dev/null 2>&1; then
    fail 'Local identity client settings could not be reconciled.'
  fi
else
  if ! "$kcadm" create clients -r tholi-local --file "$client_file" --config "$config_file" >/dev/null 2>&1; then
    fail 'Local identity client creation failed.'
  fi
fi
printf '%s\n' 'Local identity settings and account client are ready; existing users were retained.'
