#!/bin/sh

set -eu

image_archive="${1:?Usage: scan-image-layers.sh IMAGE_ARCHIVE [SENTINEL]}"
sentinel="${2:-}"
archive_contents="$(mktemp -d)"
candidate_list="$(mktemp)"

cleanup() {
  rm -f "$candidate_list"
  rm -rf "$archive_contents"
}

trap cleanup EXIT HUP INT TERM

tar -xf "$image_archive" -C "$archive_contents"
find "$archive_contents" -type f -print > "$candidate_list"

layer_count=0

while IFS= read -r candidate; do
  if tar -tf "$candidate" >/dev/null 2>&1; then
    layer_count=$((layer_count + 1))

    if tar -tf "$candidate" | grep -Eq '(^|/)\.env($|\.)'; then
      echo "Environment file found in an image layer." >&2
      exit 1
    fi

    if [ -n "$sentinel" ] && \
      tar -xOf "$candidate" 2>/dev/null | grep -a -F -q -- "$sentinel"; then
      echo "Secret-scan sentinel found in an image layer." >&2
      exit 1
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
