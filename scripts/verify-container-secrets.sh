#!/bin/sh

set -eu

image="${1:?Usage: verify-container-secrets.sh IMAGE}"
container_runtime="${CONTAINER_RUNTIME:-docker}"
sentinel="${SECRET_SCAN_SENTINEL:-}"
script_directory="$(CDPATH='' cd "$(dirname "$0")" && pwd)"

if ! command -v "$container_runtime" >/dev/null 2>&1; then
  echo "Container runtime not found: $container_runtime" >&2
  exit 1
fi

archive="$(mktemp)"
image_archive="$(mktemp)"
archive_listing="$(mktemp)"
container_id=""

cleanup() {
  if [ -n "$container_id" ]; then
    "$container_runtime" rm --force "$container_id" >/dev/null 2>&1 || true
  fi
  rm -f "$archive"
  rm -f "$image_archive"
  rm -f "$archive_listing"
}

trap cleanup EXIT HUP INT TERM

image_environment="$($container_runtime image inspect \
  --format '{{range .Config.Env}}{{println .}}{{end}}' "$image")"
image_labels="$($container_runtime image inspect \
  --format '{{json .Config.Labels}}' "$image")"

if printf '%s\n' "$image_environment" | \
  grep -Eq '^(DATABASE_URL|NEXTAUTH_URL|NEXTAUTH_SECRET|AUTH_EMAIL_API_TOKEN|PASSENGER_DATA_ENCRYPTION_KEYS|STAFF_MFA_ENCRYPTION_KEYS)='; then
  echo "Sensitive runtime configuration key found in image environment." >&2
  exit 1
fi

if printf '%s\n' "$image_labels" | \
  grep -Eq '"(DATABASE_URL|NEXTAUTH_URL|NEXTAUTH_SECRET|AUTH_EMAIL_API_TOKEN|PASSENGER_DATA_ENCRYPTION_KEYS|STAFF_MFA_ENCRYPTION_KEYS)"[[:space:]]*:'; then
  echo "Sensitive runtime configuration key found in image labels." >&2
  exit 1
fi

container_id="$($container_runtime create "$image")"
"$container_runtime" export --output "$archive" "$container_id"

# Check tar's own status. Piping into grep would report a failed export as
# "no environment file found", passing the check on an unreadable filesystem.
if ! tar -tf "$archive" > "$archive_listing"; then
  echo "Unable to list the exported container filesystem." >&2
  exit 1
fi

if grep -Eq '(^|/)\.env($|\.)' "$archive_listing"; then
  echo "Environment file found in final container filesystem." >&2
  exit 1
fi

"$container_runtime" save --output "$image_archive" "$image"

if [ -n "$sentinel" ]; then
  if grep -a -F -q -- "$sentinel" "$archive"; then
    echo "Secret-scan sentinel found in final container filesystem." >&2
    exit 1
  fi

  # Capture first so that set -e aborts on an inspect failure. Piped into grep,
  # a failed inspect would read as "sentinel not found".
  image_configuration="$("$container_runtime" image inspect "$image")"

  if printf '%s\n' "$image_configuration" | grep -F -q -- "$sentinel"; then
    echo "Secret-scan sentinel found in image configuration." >&2
    exit 1
  fi

fi

"$script_directory/scan-image-layers.sh" "$image_archive" "$sentinel"

echo "No environment files, sensitive config keys, or sentinel values found in container image."
