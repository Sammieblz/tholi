#!/bin/bash
set -euo pipefail
umask 077

: "${KC_BOOTSTRAP_ADMIN_USERNAME:?Missing local identity administrator}"
: "${KC_BOOTSTRAP_ADMIN_PASSWORD:?Missing local identity administrator password}"
: "${OIDC_TEST_PASSWORD:?Missing local test password}"

# Initialization generates URL-safe tokens. Restrict explicit replacements to
# the same alphabet so the single JSON placeholder cannot introduce JSON syntax.
if [[ ! "$OIDC_TEST_PASSWORD" =~ ^[A-Za-z0-9_-]{16,128}$ ]]; then
  printf '%s\n' 'Local identity test password must be a 16-128 character URL-safe token.' >&2
  exit 1
fi

config_file="/tmp/tholi-kcadm-${BASHPID}-${RANDOM}.config"
realm_file="/tmp/tholi-realm-${BASHPID}-${RANDOM}.json"
trap 'rm -f -- "$config_file" "$realm_file"' EXIT
kcadm=/opt/keycloak/bin/kcadm.sh

if ! "$kcadm" config credentials --config "$config_file" \
  --server http://localhost:8080 --realm master \
  --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$KC_BOOTSTRAP_ADMIN_PASSWORD" \
  >/dev/null 2>&1; then
  printf '%s\n' 'Local identity seed authentication failed.' >&2
  exit 1
fi

if ! realms=$("$kcadm" get realms --fields realm --config "$config_file" 2>/dev/null); then
  printf '%s\n' 'Local identity realm lookup failed.' >&2
  exit 1
fi
if grep -Eq '"realm"[[:space:]]*:[[:space:]]*"tholi-local"' <<<"$realms"; then
  printf '%s\n' 'Local identity realm already exists; existing data was retained.'
  exit 0
fi

realm=$(</opt/keycloak/data/import/tholi-local-realm.json)
placeholder='${OIDC_TEST_PASSWORD}'
realm=${realm//$placeholder/$OIDC_TEST_PASSWORD}
printf '%s\n' "$realm" > "$realm_file"
if ! "$kcadm" create realms --file "$realm_file" --config "$config_file" >/dev/null 2>&1; then
  printf '%s\n' 'Local identity realm creation failed.' >&2
  exit 1
fi
printf '%s\n' 'Local identity fixture realm was created.'
