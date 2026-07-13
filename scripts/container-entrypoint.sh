#!/bin/sh

set -eu

require_value() {
  variable_name="$1"
  eval "variable_value=\${$variable_name:-}"

  if [ -z "$variable_value" ]; then
    echo "Missing required environment variable: $variable_name" >&2
    exit 1
  fi
}

require_value DATABASE_URL
require_value NEXTAUTH_URL
require_value NEXTAUTH_SECRET
require_value AUTH_TRUSTED_PROXY_HOPS

case "$DATABASE_URL" in
  postgres://*|postgresql://*) ;;
  *)
    echo "DATABASE_URL must use the postgresql:// or postgres:// protocol" >&2
    exit 1
    ;;
esac

case "$NEXTAUTH_URL" in
  http://*|https://*) ;;
  *)
    echo "NEXTAUTH_URL must be a valid http:// or https:// URL" >&2
    exit 1
    ;;
esac

if [ "${#NEXTAUTH_SECRET}" -lt 32 ]; then
  echo "NEXTAUTH_SECRET must be at least 32 characters" >&2
  exit 1
fi

case "$AUTH_TRUSTED_PROXY_HOPS" in
  1|2|3|4|5) ;;
  *)
    echo "AUTH_TRUSTED_PROXY_HOPS must be between 1 and 5" >&2
    exit 1
    ;;
esac

exec "$@"
