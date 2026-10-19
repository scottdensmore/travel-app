#!/bin/sh
set -eu

check_layout() {
    volume_root=$1
    if [ ! -d "$volume_root" ]; then
        printf '%s\n' "PostgreSQL volume root is not a directory; refusing startup." >&2
        return 1
    fi
    if [ -e "$volume_root/PG_VERSION" ] || [ -e "$volume_root/data/PG_VERSION" ]; then
        printf '%s\n' \
            "Legacy PostgreSQL data layout detected. Refusing to initialize or migrate it." \
            "Preserve the existing volume and validate an upgrade or restore into a separate PostgreSQL 18 volume." \
            "See docs/postgres18-volume-layout.md before changing data." >&2
        return 1
    fi
}

if [ "$#" -gt 0 ] && [ "$1" = "--check-layout" ]; then
    if [ "$#" -ne 2 ]; then
        printf '%s\n' "Usage: postgres-layout-guard.sh --check-layout VOLUME_ROOT" >&2
        exit 64
    fi
    check_layout "$2"
    exit 0
fi

check_layout /var/lib/postgresql
exec docker-entrypoint.sh "$@"
