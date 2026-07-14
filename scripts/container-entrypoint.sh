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
require_value PASSENGER_DATA_ENCRYPTION_KEYS
require_value AUTH_TRUSTED_PROXY_HOPS
require_value AUTH_EMAIL_FROM
require_value AUTH_EMAIL_PROVIDER
require_value AUTH_EMAIL_API_URL

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

case "$AUTH_EMAIL_PROVIDER" in
  mailpit|postmark) ;;
  *)
    echo "AUTH_EMAIL_PROVIDER must be mailpit or postmark" >&2
    exit 1
    ;;
esac

case "$AUTH_EMAIL_API_URL" in
  http://*|https://*) ;;
  *)
    echo "AUTH_EMAIL_API_URL must be a valid http:// or https:// URL" >&2
    exit 1
    ;;
esac

if [ "$AUTH_EMAIL_PROVIDER" = "postmark" ] && [ -z "${AUTH_EMAIL_API_TOKEN:-}" ]; then
  echo "AUTH_EMAIL_API_TOKEN is required for Postmark" >&2
  exit 1
fi

if [ "$AUTH_EMAIL_PROVIDER" = "postmark" ]; then
  case "$NEXTAUTH_URL" in
    https://*) ;;
    *)
      echo "Postmark NEXTAUTH_URL must use https://" >&2
      exit 1
      ;;
  esac
  case "$AUTH_EMAIL_API_URL" in
    https://api.postmarkapp.com/email) ;;
    *)
      case "$AUTH_EMAIL_API_URL" in
        http://*) echo "Postmark AUTH_EMAIL_API_URL must use https://" >&2 ;;
        *) echo "Postmark AUTH_EMAIL_API_URL must be https://api.postmarkapp.com/email" >&2 ;;
      esac
      exit 1
      ;;
  esac
fi

exec "$@"
