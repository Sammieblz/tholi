#!/bin/sh
set -eu

# A live master does not prove that a fresh filer has joined its lock ring.
# Inspect the vendor's registry after its bounded connection checks complete.
snapshot=$(printf 'cluster.ps\n' | weed shell \
  -master=127.0.0.1:9333 -filer=127.0.0.1:8888 -connectTimeout=2s 2>/dev/null) || exit 1

printf '%s\n' "$snapshot" | grep -Eq '\* filers [1-9][0-9]*([[:space:]]|$)'
printf '%s\n' "$snapshot" | grep -Eq '\* volume servers [1-9][0-9]*([[:space:]]|$)'
if printf '%s\n' "$snapshot" | grep -qi 'failed to connect'; then
  exit 1
fi
