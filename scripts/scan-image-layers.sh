#!/bin/sh

set -eu

image_archive="${1:?Usage: scan-image-layers.sh IMAGE_ARCHIVE [SENTINEL]}"
sentinel="${2:-}"
archive_contents="$(mktemp -d)"
candidate_list="$(mktemp)"
layer_listing="$(mktemp)"
layer_contents="$(mktemp)"

cleanup() {
  rm -f "$candidate_list" "$layer_listing" "$layer_contents"
  rm -rf "$archive_contents"
}

trap cleanup EXIT HUP INT TERM

tar -xf "$image_archive" -C "$archive_contents"
find "$archive_contents" -type f -print > "$candidate_list"

layer_count=0

# Each producing command writes to a file whose status is checked on its own.
# Piping tar into grep would report a failed tar as "nothing found", so a layer
# that could not be read would be scanned clean. Note that `set -o pipefail`
# does not help: tar exiting 2 and grep exiting 1 still yields 1 overall, which
# is indistinguishable from a clean layer.
while IFS= read -r candidate; do
  # The listing doubles as the readable-layer check and is reused below.
  if tar -tf "$candidate" > "$layer_listing" 2>/dev/null; then
    layer_count=$((layer_count + 1))

    if grep -Eq '(^|/)\.env($|\.)' "$layer_listing"; then
      echo "Environment file found in an image layer." >&2
      exit 1
    fi

    if [ -n "$sentinel" ]; then
      if ! tar -xOf "$candidate" > "$layer_contents" 2>/dev/null; then
        echo "Unable to read layer contents for scanning: $candidate" >&2
        exit 1
      fi

      if grep -a -F -q -- "$sentinel" "$layer_contents"; then
        echo "Secret-scan sentinel found in an image layer." >&2
        exit 1
      fi
    fi
  elif [ -n "$sentinel" ] && grep -a -F -q -- "$sentinel" "$candidate"; then
    echo "Secret-scan sentinel found in image metadata." >&2
    exit 1
  fi
done < "$candidate_list"

if [ "$layer_count" -eq 0 ]; then
  echo "No readable image layers found in archive." >&2
  exit 1
fi

if [ "$layer_count" -eq 1 ]; then
  echo "Scanned 1 image layer."
else
  echo "Scanned $layer_count image layers."
fi
