#!/bin/sh
# The official entrypoint sources non-executable scripts. Keep its shell alive
# and its options unchanged when this file runs during database initialization.
(
  set -eu

  : "${THOLI_DB_PASSWORD:?Missing local runtime password}"
  : "${THOLI_MIGRATION_PASSWORD:?Missing local migration password}"
  : "${OIDC_DB_PASSWORD:?Missing local identity password}"

  psql --no-psqlrc --username "${POSTGRES_USER:-postgres}" --dbname postgres \
    --set ON_ERROR_STOP=1 --file /opt/tholi/postgres/bootstrap.sql
)
